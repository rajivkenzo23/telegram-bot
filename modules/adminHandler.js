const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { config, formatMessage } = require('../config');
const { generateCaption, generateSlug, generateDescription } = require('./captionGenerator');
const { addVideo } = require('./dataManager');
const { downloadTelegramFile } = require('./telegramDownloader');
const { postToPremiumChannel } = require('./channelPoster');

const adminState = {};

function isAdmin(userId) {
  return userId === config.adminId;
}

function initAdminHandler(bot, processVideo, uploadToGithub, postToFreeChannel) {
  bot.on('video', async (msg) => {
    if (!isAdmin(msg.from.id)) return;

    const chatId = msg.chat.id;
    const video = msg.video;
    const caption = msg.caption || null;

    let thumbFileId = null;
    if (video.thumb) thumbFileId = video.thumb.file_id;
    else if (video.thumbnail) thumbFileId = video.thumbnail.file_id;

    adminState[chatId] = {
      fileId: video.file_id,
      thumbFileId,
      duration: video.duration || 0,
      fileSize: video.file_size || 0,
      step: caption ? 'ready' : 'waiting_caption',
      caption
    };

    if (caption) {
      await processAdminVideo(bot, chatId, uploadToGithub, postToFreeChannel);
    } else {
      await bot.sendMessage(chatId,
        formatMessage(config.messages.askCaption),
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎲 Random Caption Generate කරන්න', callback_data: 'random_caption' }],
              [{ text: '❌ Cancel', callback_data: 'cancel_upload' }]
            ]
          }
        }
      );
    }
  });

  bot.on('document', async (msg) => {
    if (!isAdmin(msg.from.id)) return;

    const doc = msg.document;
    if (!doc.mime_type || !doc.mime_type.startsWith('video/')) return;

    const chatId = msg.chat.id;
    const caption = msg.caption || null;

    let thumbFileId = null;
    if (doc.thumb) thumbFileId = doc.thumb.file_id;
    else if (doc.thumbnail) thumbFileId = doc.thumbnail.file_id;

    adminState[chatId] = {
      fileId: doc.file_id,
      thumbFileId,
      duration: 0,
      fileSize: doc.file_size || 0,
      step: caption ? 'ready' : 'waiting_caption',
      caption,
      fileName: doc.file_name || ''
    };

    if (caption) {
      await processAdminVideo(bot, chatId, uploadToGithub, postToFreeChannel);
    } else {
      await bot.sendMessage(chatId,
        formatMessage(config.messages.askCaption),
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎲 Random Caption', callback_data: 'random_caption' }],
              [{ text: '❌ Cancel', callback_data: 'cancel_upload' }]
            ]
          }
        }
      );
    }
  });

  bot.on('text', async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    if (msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;

    if (adminState[chatId] && adminState[chatId].step === 'waiting_caption') {
      adminState[chatId].caption = msg.text;
      adminState[chatId].step = 'ready';
      await processAdminVideo(bot, chatId, uploadToGithub, postToFreeChannel);
    }
  });

  bot.on('callback_query', async (query) => {
    if (!isAdmin(query.from.id)) return;

    const chatId = query.message.chat.id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id);

    if (data === 'random_caption') {
      if (adminState[chatId]) {
        const hint = adminState[chatId].fileName || adminState[chatId].caption || '';
        adminState[chatId].caption = generateCaption(hint);
        adminState[chatId].step = 'ready';

        await bot.sendMessage(chatId, `🎲 Generated:\n\n*${adminState[chatId].caption}*`, {
          parse_mode: 'Markdown'
        });

        await processAdminVideo(bot, chatId, uploadToGithub, postToFreeChannel);
      }
    }

    if (data === 'cancel_upload') {
      delete adminState[chatId];
      await bot.sendMessage(chatId, '❌ Upload cancelled.');
    }
  });

  bot.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const { getStats } = require('./dataManager');
    const stats = getStats();

    await bot.sendMessage(msg.chat.id,
      `📊 *Bot Statistics*\n\n` +
      `📹 Total Videos: ${stats.totalVideos}\n` +
      `👥 Total Users: ${stats.totalUsers}\n` +
      `📤 Total Deliveries: ${stats.totalDeliveries}\n\n` +
      `🖥 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB\n` +
      `⏱ Uptime: ${formatUptime(process.uptime())}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/list/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const { getAllVideos } = require('./dataManager');
    const videos = getAllVideos();
    const keys = Object.keys(videos);

    if (keys.length === 0) {
      await bot.sendMessage(msg.chat.id, '📹 No videos yet. Send me a video!');
      return;
    }

    let list = '📋 *Video List*\n\n';
    keys.slice(-20).forEach((key, i) => {
      const v = videos[key];
      list += `${i + 1}. ${v.title || key}\n`;
      list += `   🔗 ${config.siteUrl}/watch/${key}.html\n\n`;
    });

    await bot.sendMessage(msg.chat.id, list, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/help/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;

    await bot.sendMessage(msg.chat.id,
      `🔧 *Admin Help*\n\n` +
      `📹 Send any video to upload\n` +
      `💎 Auto-posts FULL to premium channel\n` +
      `🆓 Auto-posts 5-8s preview to all free channels\n` +
      `⭐ Premium upsell appears on every delivery\n\n` +
      `📋 Commands:\n` +
      `/stats — Statistics + channel performance\n` +
      `/list — Video list\n` +
      `/listchannels — List free channels\n` +
      `/addchannel — Add free channel (forward a message from it)\n` +
      `/removechannel <id> — Remove free channel\n` +
      `/togglechannel <id> — Enable/disable channel\n` +
      `/restorechannels — Pull channels backup from GitHub after redeploy\n` +
      `/regen-tags — Rebuild all tag pages (run once after upgrade)\n` +
      `/help — This menu`,
      { parse_mode: 'Markdown' }
    );
  });

  // ===== /regen-tags — rebuild all tag pages from existing videos =====
  bot.onText(/^\/regen-tags/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const chatId = msg.chat.id;
    const status = await bot.sendMessage(chatId, '🔄 Rebuilding all tag pages from existing inventory...');
    try {
      const { uploadFile, fetchExistingVideos } = require('./githubUploader');
      const { generateAllTagPages } = require('./tagPageGenerator');
      const videos = await fetchExistingVideos();
      const files = generateAllTagPages(videos);
      let ok = 0;
      for (const f of files) {
        try {
          await uploadFile(f.path, f.content, f.commit, false);
          ok++;
          if (ok % 5 === 0) {
            await bot.editMessageText(`🔄 Rebuilding... ${ok}/${files.length}`, { chat_id: chatId, message_id: status.message_id });
          }
        } catch (e) {
          console.error(`Failed ${f.path}: ${e.message}`);
        }
      }
      await bot.editMessageText(
        `✅ Tag pages rebuilt!\n\n${ok}/${files.length} files pushed to GitHub.\n\nVisit ${config.siteUrl}/tag/ to browse.`,
        { chat_id: chatId, message_id: status.message_id }
      );
    } catch (e) {
      await bot.editMessageText(`❌ Failed: ${e.message}`, { chat_id: chatId, message_id: status.message_id });
    }
  });

  // ===== Channel management =====
  const { listChannels, addChannel, removeChannel, toggleChannel, readChannelStats } = require('./channelRegistry');

  // /addchannel @username  OR forward a channel message
  bot.onText(/^\/addchannel(?:\s+(.+))?/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const arg = (msg.text.match(/^\/addchannel(?:\s+(.+))?/) || [])[1];
    if (!arg) {
      await bot.sendMessage(msg.chat.id,
        `🛠 *Add a free channel*\n\n` +
        `Two ways:\n` +
        `1. \`/addchannel @username niche=sinhala delay=90\`\n` +
        `2. Forward any post from the channel to me (bot must already be admin of it).`,
        { parse_mode: 'Markdown' });
      adminPending[msg.chat.id] = { op: 'add_channel' };
      return;
    }
    await tryAddChannelByArg(bot, msg.chat.id, arg);
  });

  bot.onText(/^\/listchannels/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const channels = listChannels();
    const stats = readChannelStats();
    if (channels.length === 0) {
      await bot.sendMessage(msg.chat.id, '📭 No free channels configured.');
      return;
    }
    const lines = channels.map((c, i) =>
      `${i + 1}. ${c.enabled ? '✅' : '⛔'} \`${c.id}\`  ` +
      (c.username ? `@${c.username}  ` : '') +
      `(ref \`${c.ref}\`, niche ${c.niche}, +${c.delaySec}s)\n` +
      `   📊 deliveries: ${(stats[c.ref] && stats[c.ref].total) || 0}`
    );
    await bot.sendMessage(msg.chat.id,
      `📡 *Free Channels (${channels.length})*\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/removechannel\s+(-?\d+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const id = match[1];
    const ok = removeChannel(id);
    await bot.sendMessage(msg.chat.id, ok ? `✅ Removed channel ${id}` : `❌ Channel ${id} not found (or it's the legacy env channel — change FREE_CHANNEL_ID in .env instead).`);
  });

  bot.onText(/^\/restorechannels/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const chatId = msg.chat.id;
    const status = await bot.sendMessage(chatId, '🔄 Restoring channels.json from GitHub backup...');
    try {
      const https = require('https');
      const url = `${config.siteUrl}/assets/data/channels.backup.json`;
      const text = await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          let body = ''; res.on('data', c => body += c); res.on('end', () => resolve(body));
        }).on('error', reject);
      });
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.channels)) throw new Error('Invalid backup format');
      const fs = require('fs');
      const path = require('path');
      const dst = path.join(__dirname, '..', 'data', 'channels.json');
      if (!fs.existsSync(path.dirname(dst))) fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, JSON.stringify(parsed, null, 2));
      await bot.editMessageText(`✅ Restored ${parsed.channels.length} channel(s).\nUse /listchannels to verify.`, { chat_id: chatId, message_id: status.message_id });
    } catch (e) {
      await bot.editMessageText(`❌ Restore failed: ${e.message}`, { chat_id: chatId, message_id: status.message_id });
    }
  });

  bot.onText(/^\/togglechannel\s+(-?\d+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const id = match[1];
    const current = listChannels().find(c => String(c.id) === String(id));
    if (!current) return bot.sendMessage(msg.chat.id, `❌ Channel ${id} not found`);
    const next = !current.enabled;
    const ok = toggleChannel(id, next);
    await bot.sendMessage(msg.chat.id, ok ? `✅ Channel ${id} now ${next ? 'ENABLED' : 'DISABLED'}` : `❌ Cannot toggle (legacy env channel?)`);
  });

  // Forwarded message → infer channel id if pending /addchannel
  bot.on('message', async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    if (!adminPending[msg.chat.id] || adminPending[msg.chat.id].op !== 'add_channel') return;
    const fwd = msg.forward_from_chat;
    if (!fwd || fwd.type !== 'channel') return;
    delete adminPending[msg.chat.id];
    try {
      const added = addChannel({
        id: fwd.id,
        username: fwd.username || '',
        niche: 'default',
        delaySec: 60,
        captionStyle: 'default'
      });
      await bot.sendMessage(msg.chat.id,
        `✅ Channel added!\n\`${added.id}\`  @${added.username || '—'}\nref \`${added.ref}\`\n\nMake sure the bot has *Post Messages* permission in that channel.`,
        { parse_mode: 'Markdown' });
    } catch (e) {
      await bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
    }
  });
}

// Local state for multi-step admin operations (e.g. waiting for a forwarded message)
const adminPending = {};

async function tryAddChannelByArg(bot, chatId, arg) {
  // Parse "@username niche=foo delay=90 style=short"
  const tokens = arg.trim().split(/\s+/);
  const username = tokens[0].replace(/^@/, '');
  const opts = {};
  tokens.slice(1).forEach(t => {
    const [k, v] = t.split('=');
    if (k && v) opts[k.toLowerCase()] = v;
  });
  try {
    // Resolve username → numeric id via getChat
    const chat = await bot.getChat('@' + username);
    if (chat.type !== 'channel') throw new Error('Not a channel');
    const { addChannel } = require('./channelRegistry');
    const added = addChannel({
      id: chat.id,
      username: chat.username || username,
      niche: opts.niche || 'default',
      delaySec: parseInt(opts.delay || '60', 10),
      captionStyle: opts.style || 'default'
    });
    await bot.sendMessage(chatId,
      `✅ Channel added!\n\`${added.id}\`  @${added.username}\nref \`${added.ref}\`, niche \`${added.niche}\`, +${added.delaySec}s\n\nBot must be admin of that channel with *Post Messages*.`,
      { parse_mode: 'Markdown' });
  } catch (e) {
    await bot.sendMessage(chatId, `❌ Could not add channel: ${e.message}\n\nTip: bot must already be an admin of the channel for getChat to resolve it.`);
  }
}

const { formatDuration, formatDurationISO, processVideo } = require('./videoProcessor');

async function processAdminVideo(bot, chatId, uploadToGithub, postToFreeChannel) {
  const state = adminState[chatId];
  if (!state || state.step !== 'ready') return;

  const caption = state.caption;
  const slug = generateSlug(caption);
  const description = generateDescription(caption);
  const videoLink = `${config.siteUrl}/watch/${slug}.html`;
  const durationSec = state.duration || 0;

  const processingMsg = await bot.sendMessage(chatId,
    '⏳ *Processing...*\n\n🖼 Starting...',
    { parse_mode: 'Markdown' }
  );

  let localThumbPath = null;
  let localVideoPath = null;
  let localPreviewPath = null;
  let processed = null;

  try {
    // ===== STEP 1/6: Auto-post FULL video to PREMIUM channel (silent, no ads) =====
    await updateMsg(bot, chatId, processingMsg.message_id,
      '⏳ *Step 1/6:* 💎 Posting full video to premium channel...');

    await postToPremiumChannel(bot, state.fileId, caption);

    // ===== STEP 2/6: Download video (for ffmpeg preview + thumbnail) =====
    await updateMsg(bot, chatId, processingMsg.message_id,
      '⏳ *Step 2/6:* ⬇️ Downloading video for preview...');

    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    localVideoPath = path.join(tempDir, `${slug}_full.mp4`);

    let videoDownloaded = false;
    try {
      await downloadTelegramFile(bot, state.fileId, localVideoPath);
      videoDownloaded = true;
    } catch (dlErr) {
      const isSizeIssue = String(dlErr.message).startsWith('TOO_LARGE');
      console.log(`   ⚠️  Video download skipped: ${dlErr.message}`);
      if (isSizeIssue) {
        await updateMsg(bot, chatId, processingMsg.message_id,
          '⚠️  Video >20MB — skipping FFmpeg preview, using thumbnail only');
      }
    }

    // ===== STEP 3/6: Generate 5-8s preview clip + WebP thumbnail =====
    let thumbnailBase64 = null;
    let thumbExtension = 'jpg';

    if (videoDownloaded) {
      try {
        await updateMsg(bot, chatId, processingMsg.message_id,
          '⏳ *Step 3/6:* 🎬 Generating 5-8s preview clip...');
        processed = await processVideo(localVideoPath, slug);
        localPreviewPath = processed.previewPath;
        localThumbPath = processed.thumbnailPath;
        thumbnailBase64 = fs.readFileSync(localThumbPath).toString('base64');
        thumbExtension = (path.extname(localThumbPath).replace('.', '') || 'webp').toLowerCase();
      } catch (procErr) {
        console.error(`   ⚠️  Preview generation failed: ${procErr.message}`);
        localPreviewPath = null;
      }
    }

    // Fallback: download Telegram's auto-thumbnail
    if (!thumbnailBase64 && state.thumbFileId) {
      try {
        const thumbData = await downloadTelegramThumbnail(bot, state.thumbFileId, slug);
        thumbnailBase64 = thumbData.base64;
        thumbExtension = thumbData.extension;
        localThumbPath = thumbData.localPath;
      } catch (e) {
        console.error(`   ⚠️  Thumbnail download failed: ${e.message}`);
      }
    }

    if (!thumbnailBase64) {
      thumbnailBase64 = generatePlaceholderThumb();
      thumbExtension = 'jpg';
      localThumbPath = await createPlaceholderThumbFile(slug);
    }

    // ===== STEP 4/6: Publish to website (GitHub + sitemap) =====
    await updateMsg(bot, chatId, processingMsg.message_id,
      '⏳ *Step 4/6:* 🌐 Publishing watch page to website...');

    const finalDurationSec = (processed && processed.durationSeconds) || durationSec || 0;
    const duration = {
      duration: formatDuration(finalDurationSec),
      durationISO: formatDurationISO(finalDurationSec),
      durationSeconds: finalDurationSec
    };
    await uploadToGithub(slug, caption, description, thumbnailBase64, thumbExtension, duration, state, localPreviewPath);

    // ===== STEP 5/6: Post preview clip to FREE channel =====
    await updateMsg(bot, chatId, processingMsg.message_id,
      '⏳ *Step 5/6:* 📢 Posting preview to free channel...');

    await postToFreeChannel(bot, localThumbPath, caption, videoLink, localPreviewPath);

    // ===== STEP 6/6: Save metadata =====
    await updateMsg(bot, chatId, processingMsg.message_id,
      '⏳ *Step 6/6:* 💾 Saving metadata...');

    addVideo(slug, {
      title: caption,
      description,
      slug,
      fileId: state.fileId,
      duration: duration.duration,
      link: videoLink
    });

    await bot.editMessageText(
      formatMessage(config.messages.success, { TITLE: caption, LINK: videoLink }),
      {
        chat_id: chatId,
        message_id: processingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌐 View on Website', url: videoLink }],
            [{ text: '🆓 Free Channel', url: `https://t.me/${config.freeChannelUsername}` }],
            [{ text: '💎 Premium Channel', url: config.premiumInviteLink }]
          ]
        }
      }
    );

    cleanupTempFiles(slug);
    delete adminState[chatId];
    console.log(`✅ Video added successfully: ${slug}`);

    // Fire-and-forget — refresh public stats snapshot
    try { require('./statsPublisher').publishNow(); } catch (_) {}

  } catch (error) {
    console.error('❌ Admin Process Error:', error);

    await bot.editMessageText(
      `❌ *Error:*\n${error.message || 'Unknown processing error'}`,
      {
        chat_id: chatId,
        message_id: processingMsg.message_id,
        parse_mode: 'Markdown'
      }
    ).catch(e => console.error('Failed to send error message:', e.message));

    cleanupTempFiles(slug);
    delete adminState[chatId];
  }
}

function downloadTelegramThumbnail(bot, thumbFileId, slug) {
  return new Promise(async (resolve, reject) => {
    try {
      const file = await bot.getFile(thumbFileId);
      const filePath = file.file_path;
      const downloadUrl = `${config.telegramApiBaseUrl}/file/bot${config.botToken}/${filePath}`;
      const extension = path.extname(filePath).replace('.', '') || 'jpg';

      const tempDir = path.join(__dirname, '..', 'temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const localPath = path.join(tempDir, `${slug}_thumb.${extension}`);
      const writer = fs.createWriteStream(localPath);
      const chunks = [];

      const protocol = downloadUrl.startsWith('https') ? https : http;

      protocol.get(downloadUrl, (response) => {
        response.on('data', chunk => {
          chunks.push(chunk);
          writer.write(chunk);
        });

        response.on('end', () => {
          writer.end();
          const buffer = Buffer.concat(chunks);
          resolve({ base64: buffer.toString('base64'), extension, localPath });
        });

        response.on('error', err => reject(err));
      }).on('error', err => reject(err));

    } catch (err) {
      reject(err);
    }
  });
}

async function createPlaceholderThumbFile(slug) {
  const tempDir = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const localPath = path.join(tempDir, `${slug}_thumb.jpg`);
  fs.writeFileSync(localPath, Buffer.from(generatePlaceholderThumb(), 'base64'));
  return localPath;
}

function generatePlaceholderThumb() {
  return Buffer.from([
    0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,
    0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0xFF,0xDB,0x00,0x43,
    0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,0x07,0x07,0x07,0x09,
    0x09,0x08,0x0A,0x0C,0x14,0x0D,0x0C,0x0B,0x0B,0x0C,0x19,0x12,
    0x13,0x0F,0x14,0x1D,0x1A,0x1F,0x1E,0x1D,0x1A,0x1C,0x1C,0x20,
    0x24,0x2E,0x27,0x20,0x22,0x2C,0x23,0x1C,0x1C,0x28,0x37,0x29,
    0x2C,0x30,0x31,0x34,0x34,0x34,0x1F,0x27,0x39,0x3D,0x38,0x32,
    0x3C,0x2E,0x33,0x34,0x32,0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,
    0x00,0x01,0x01,0x01,0x11,0x00,0xFF,0xC4,0x00,0x14,0x00,0x01,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0xFF,0xC4,0x00,0x14,0x10,0x01,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0xFF,0xDA,0x00,0x08,0x01,0x01,0x00,0x00,0x3F,0x00,
    0x7B,0x40,0x1B,0xFF,0xD9
  ]).toString('base64');
}

function cleanupTempFiles(slug) {
  try {
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) return;
    fs.readdirSync(tempDir).forEach(file => {
      if (file.includes(slug)) {
        try { fs.unlinkSync(path.join(tempDir, file)); } catch (_) {}
      }
    });
  } catch (_) {}
}

async function updateMsg(bot, chatId, msgId, text) {
  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
  } catch (_) {}
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = { initAdminHandler, isAdmin };