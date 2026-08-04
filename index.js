process.env.NTBA_FIX_350 = '1';
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// Auto-repair Git tracking branch for Pterodactyl environments
try {
  if (fs.existsSync(path.join(__dirname, '.git'))) {
    execSync('git fetch origin main', { stdio: 'ignore' });
    execSync('git checkout -B main origin/main', { stdio: 'ignore' });
    execSync('git branch --set-upstream-to=origin/main main', { stdio: 'ignore' });
  }
} catch (_) {}

const TelegramBotModule = require('node-telegram-bot-api');
const TelegramBot = typeof TelegramBotModule === 'function'
  ? TelegramBotModule
  : (TelegramBotModule.default || TelegramBotModule.TelegramBot || TelegramBotModule);

const { config, validateConfig } = require('./config');
const { initAdminHandler } = require('./modules/adminHandler');
const { initUserHandler } = require('./modules/userHandler');

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
let ffmpegSource = 'system';
let ffmpegBinPath = 'ffmpeg';
try {
  const staticPath = require('ffmpeg-static');
  if (staticPath && fs.existsSync(staticPath)) {
    require('fluent-ffmpeg').setFfmpegPath(staticPath);
    ffmpegBinPath = staticPath;
    ffmpegSource = 'bundled (ffmpeg-static)';
  }
} catch (e) {}

exec(`"${ffmpegBinPath}" -version`, (err, stdout) => {
  if (err) {
    console.log(`⚠️  FFmpeg not usable (${ffmpegSource}) — preview generation will be skipped`);
  } else {
    console.log(`✅ FFmpeg ${ffmpegSource}: ${stdout.split('\n')[0]}`);
  }
});

initAdminHandler(bot);
initUserHandler(bot);

if (!config.siteUrl) {
  console.log('Retention system disabled because SITE_URL is empty');
} else try {
  const { initRetentionSystem } = require('./modules/retentionLoop');
  initRetentionSystem(bot);
} catch (e) {
  console.log('⚠️  Retention system not loaded');
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
