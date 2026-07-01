process.env.NTBA_FIX_350 = '1';
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
const TelegramBot = require('node-telegram-bot-api');
const { config, validateConfig } = require('./config');
const { initAdminHandler } = require('./modules/adminHandler');
const { initUserHandler } = require('./modules/userHandler');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '.env') });

validateConfig();

const bot = new TelegramBot(config.botToken, {
  request: { agentOptions: { family: 4 } },
  baseApiUrl: config.telegramApiBaseUrl,
  polling: {
    interval: 1000,
    autoStart: true,
    params: { timeout: 30 }
  }
});

bot.getMe().then((me) => {
  console.log(`🤖 Bot Info  : @${me.username} (${me.first_name})`);
}).catch((err) => {
  console.error(`❌ Failed to get bot info: ${err.message}`);
});

console.log('');
console.log('╔══════════════════════════════════════════╗');
console.log('║       🎬 VideoSLK Bot — Free Flow       ║');
console.log('╠══════════════════════════════════════════╣');
console.log(`║  👤 Admin  : ${config.adminId}`);
console.log(`║  🆓 Free   : @${config.freeChannelUsername}`);
console.log(`║  🌐 Site   : ${config.siteUrl}`);
console.log('╚══════════════════════════════════════════╝');
console.log('');

[path.join(__dirname, 'temp'), path.join(__dirname, 'data')].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created: ${dir}`);
  }
});

const dataPath = path.join(__dirname, 'data', 'videoStore.json');
if (!fs.existsSync(dataPath)) {
  fs.writeFileSync(dataPath, JSON.stringify({
    videos: {},
    stats: { totalVideos: 0, totalDeliveries: 0, totalUsers: 0 },
    users: {}
  }, null, 2));
  console.log('📁 Created videoStore.json');
}

// ===== FFmpeg setup =====
// Prefer the bundled ffmpeg-static binary if installed (works in restricted
// Docker images like Pterodactyl yolks:nodejs_20 which don't ship ffmpeg).
// Falls back to system ffmpeg from PATH.
let ffmpegSource = 'system';
let ffmpegBinPath = 'ffmpeg';
try {
  const staticPath = require('ffmpeg-static');
  if (staticPath && fs.existsSync(staticPath)) {
    require('fluent-ffmpeg').setFfmpegPath(staticPath);
    ffmpegBinPath = staticPath;
    ffmpegSource = 'bundled (ffmpeg-static)';
  }
} catch (e) {
  // ffmpeg-static not installed — keep system fallback
}

exec(`"${ffmpegBinPath}" -version`, (err, stdout) => {
  if (err) {
    console.log(`⚠️  FFmpeg not usable (${ffmpegSource}) — preview generation will be skipped`);
    console.log(`   Fix on Pterodactyl: add "ffmpeg-static" to NODE_PACKAGES and restart.`);
  } else {
    console.log(`✅ FFmpeg ${ffmpegSource}: ${stdout.split('\n')[0]}`);
  }
});

let _githubUploader = null;
let _channelPoster = null;

async function uploadToGithub(slug, caption, description, thumbnailBase64, thumbExtension, duration, state, localPreviewPath) {
  if (!_githubUploader) _githubUploader = require('./modules/githubUploader');
  return await _githubUploader.uploadVideoFiles(slug, caption, description, thumbnailBase64, thumbExtension, duration, state, localPreviewPath);
}

async function postToFreeChannel(bot, localThumbPath, caption, embedUrls, localPreviewPath) {
  if (!_channelPoster) _channelPoster = require('./modules/channelPoster');
  // Use the multi-channel broadcaster — falls back to single-channel if no channels.json
  return await _channelPoster.broadcastToFreeChannels(bot, {
    localThumbPath,
    caption,
    embedUrls,
    localPreviewPath
  });
}

const { processVideo } = require('./modules/videoProcessor');
initAdminHandler(bot, processVideo, uploadToGithub);
initUserHandler(bot);

try {
  const { initRetentionSystem } = require('./modules/retentionLoop');
  initRetentionSystem(bot);
} catch (e) {
  console.log('⚠️  Retention system not loaded');
}

// Periodic stats snapshot → assets/data/stats.json on GitHub (admin dashboard reads it)
try {
  const { startPeriodic } = require('./modules/statsPublisher');
  const { uploadFile } = require('./modules/githubUploader');
  startPeriodic(uploadFile, 5 * 60 * 1000);
  console.log('📊 Stats publisher started (every 5 min)');
} catch (e) {
  console.log('⚠️  Stats publisher not started:', e.message);
}

setInterval(() => {
  const mem = process.memoryUsage();
  if (mem.heapUsed > 400 * 1024 * 1024) {
    console.log(`⚠️ High memory: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`);
    if (global.gc) global.gc();
  }
}, 120000);

setInterval(() => {
  const tempDir = path.join(__dirname, 'temp');
  try {
    if (!fs.existsSync(tempDir)) return;
    const now = Date.now();
    fs.readdirSync(tempDir).forEach(file => {
      const filePath = path.join(tempDir, file);
      try {
        if (now - fs.statSync(filePath).mtimeMs > 15 * 60 * 1000) {
          fs.unlinkSync(filePath);
          console.log(`🧹 Cleaned: ${file}`);
        }
      } catch (_) {}
    });
  } catch (_) {}
}, 5 * 60 * 1000);

bot.on('polling_error', (error) => {
  const status = error.response ? error.response.statusCode : 'unknown';
  if (status === 409) console.error('❌ Another bot instance running!');
  else if (status === 401) console.error('❌ Invalid bot token!');
  else console.error(`❌ Polling error: ${error.code || 'unknown'} - ${error.message}`);
});

bot.on('error', (error) => console.error('❌ Bot error:', error.message));

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  console.error(error.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

function shutdown(signal) {
  console.log(`\n🛑 ${signal} — shutting down...`);
  bot.stopPolling();
  try {
    const tempDir = path.join(__dirname, 'temp');
    if (fs.existsSync(tempDir)) {
      fs.readdirSync(tempDir).forEach(f => {
        try { fs.unlinkSync(path.join(tempDir, f)); } catch (_) {}
      });
    }
  } catch (_) {}
  console.log('👋 Bot stopped.\n');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log('✅ Bot is online!');
console.log('📹 Send a video to start processing!');
console.log('════════════════════════════════════════\n');