const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { config, formatMessage } = require('../config');
const { generateCaption, generateSlug, generateDescription } = require('./captionGenerator');
const { addVideo } = require('./dataManager');
const { downloadTelegramFile } = require('./telegramDownloader');
const { postToPremiumChannelBatch, postToFreeChannel } = require('./channelPoster');

const adminState = {};

function isAdmin(userId) {
  return userId === config.adminId;
}

function initAdminHandler(bot, processVideo, uploadToGithub) {
  // Admin Start Keyboard
  bot.onText(/^\/start$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    bot.sendMessage(msg.chat.id, "👋 Welcome back, Admin. What would you like to do?", {
      reply_markup: {
        keyboard: [
          [{ text: '📤 Upload Files' }, { text: '📊 Stats' }]
        ],
        resize_keyboard: true
      }
    });
  });

  bot.on('message', async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const chatId = msg.chat.id;
    const text = msg.text;

    // Trigger Upload
    if (text === '📤 Upload Files' || text === '/upload') {
      adminState[chatId] = { step: 'collecting', videos: [], statusMsgId: null };
      const m = await bot.sendMessage(chatId, "📥 Send me your videos (Batch supported). When you are finished, click 'Done Uploading'.", {
        reply_markup: {
          inline_keyboard: [[{ text: '✅ Done Uploading', callback_data: 'batch_done' }], [{ text: '❌ Cancel', callback_data: 'cancel_upload' }]]
        }
      });
      adminState[chatId].statusMsgId = m.message_id;
      return;
    }

    // Handle Text in states
    const state = adminState[chatId];
    if (state && state.step === 'waiting_caption' && text && !text.startsWith('/')) {
      state.caption = text;
      state.step = 'waiting_preview_choice';
      bot.sendMessage(chatId, `Caption set to: \n*${text}*\n\nNow, how should we handle the preview?`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎬 Auto (Generate 5-8s clip from first video)', callback_data: 'batch_preview_auto' }],
            [{ text: '🖼 Upload Custom Preview', callback_data: 'batch_preview_custom' }]
          ]
        }
      });
      return;
    }
  });

  bot.on('video', handleMedia);
  bot.on('document', handleMedia);
  bot.on('photo', handleMedia);

  async function handleMedia(msg) {
    if (!isAdmin(msg.from.id)) return;
    const chatId = msg.chat.id;
    const state = adminState[chatId];
    if (!state) return;

    if (state.step === 'collecting') {
      let fileId, fileSize, thumbFileId, fileName;
      if (msg.video) {
        fileId = msg.video.file_id;
        fileSize = msg.video.file_size;
        thumbFileId = msg.video.thumb ? msg.video.thumb.file_id : null;
        fileName = msg.video.file_name || 'video.mp4';
      } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('video/')) {
        fileId = msg.document.file_id;
        fileSize = msg.document.file_size;
        thumbFileId = msg.document.thumb ? msg.document.thumb.file_id : null;
        fileName = msg.document.file_name || 'video.mp4';
      } else {
        return; // ignore non-videos during collection
      }

      state.videos.push({ fileId, fileSize, thumbFileId, fileName });
      
      // Update status message
      try {
        await bot.editMessageText(`📥 Collecting videos...\n✅ Received: ${state.videos.length} videos\n\nSend more or click 'Done Uploading'.`, {
          chat_id: chatId,
          message_id: state.statusMsgId,
          reply_markup: {
            inline_keyboard: [[{ text: '✅ Done Uploading', callback_data: 'batch_done' }], [{ text: '❌ Cancel', callback_data: 'cancel_upload' }]]
          }
        });
      } catch(e) {}
    } else if (state.step === 'waiting_custom_preview') {
      let previewFileId = null;
      let previewType = 'photo';
      if (msg.photo) {
        previewFileId = msg.photo[msg.photo.length - 1].file_id;
      } else if (msg.video) {
        previewFileId = msg.video.file_id;
        previewType = 'video';
      } else if (msg.document) {
        previewFileId = msg.document.file_id;
        previewType = msg.document.mime_type.startsWith('video/') ? 'video' : 'photo';
      }

      if (!previewFileId) return bot.sendMessage(chatId, "❌ Please send a valid photo or video.");

      state.previewType = 'custom_' + previewType;
      state.customPreviewFileId = previewFileId;
      state.step = 'ready';
      bot.sendMessage(chatId, "✅ Custom preview received. Starting process...");
      await processAdminBatch(bot, chatId, processVideo, uploadToGithub);
    }
  }

  bot.on('callback_query', async (query) => {
    if (!isAdmin(query.from.id)) return;
    const chatId = query.message.chat.id;
    const data = query.data;
    const state = adminState[chatId];
    await bot.answerCallbackQuery(query.id);

    if (data === 'cancel_upload') {
      delete adminState[chatId];
      bot.editMessageText('❌ Upload cancelled.', { chat_id: chatId, message_id: query.message.message_id });
      return;
    }

    if (!state) return;

    if (data === 'batch_done') {
      if (state.videos.length === 0) {
        bot.sendMessage(chatId, "❌ You haven't sent any videos!");
        return;
      }
      state.step = 'waiting_caption';
      bot.editMessageText(`✅ Received ${state.videos.length} videos.\n\nNow, send me a custom caption, or click Random.`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: '🎲 Random Caption', callback_data: 'batch_caption_random' }], [{ text: '❌ Cancel', callback_data: 'cancel_upload' }]]
        }
      });
    } else if (data === 'batch_caption_random') {
      const hint = state.videos[0].fileName || '';
      state.caption = generateCaption(hint);
      state.step = 'waiting_preview_choice';
      bot.editMessageText(`🎲 Generated Caption:\n*${state.caption}*\n\nNow, how should we handle the preview?`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎬 Auto (Generate clip)', callback_data: 'batch_preview_auto' }],
            [{ text: '🖼 Upload Custom Preview', callback_data: 'batch_preview_custom' }]
          ]
        }
      });
    } else if (data === 'batch_preview_auto') {
      state.previewType = 'auto';
      state.step = 'ready';
      bot.editMessageText('✅ Auto preview selected. Starting process...', { chat_id: chatId, message_id: query.message.message_id });
      await processAdminBatch(bot, chatId, processVideo, uploadToGithub);
    } else if (data === 'batch_preview_custom') {
      state.step = 'waiting_custom_preview';
      bot.editMessageText('🖼 Please send the custom preview image or video now.', { chat_id: chatId, message_id: query.message.message_id });
    }
  });

  // Keep old stats and list handlers
  bot.onText(/^\/stats$|📊 Stats/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const { getStats } = require('./dataManager');
    const stats = getStats();
    await bot.sendMessage(msg.chat.id,
      `📊 *Bot Statistics*\n\n` +
      `📹 Total Posts: ${stats.totalVideos}\n` +
      `👥 Total Users: ${stats.totalUsers}\n` +
      `📤 Total Deliveries: ${stats.totalDeliveries}\n\n` +
      `🖥 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB`,
      { parse_mode: 'Markdown' }
    );
  });
}

const { formatDuration, formatDurationISO } = require('./videoProcessor');

async function processAdminBatch(bot, chatId, processVideo, uploadToGithub) {
  const state = adminState[chatId];
  if (!state || state.step !== 'ready') return;

  const caption = state.caption;
  const slug = generateSlug(caption);
  const description = generateDescription(caption);
  const videoLink = `${config.siteUrl}/watch/${slug}.html`;
  
  const processingMsg = await bot.sendMessage(chatId, '⏳ *Processing Batch...*\n\n🖼 Starting...', { parse_mode: 'Markdown' });

  let localThumbPath = null;
  let localVideoPath = null;
  let localPreviewPath = null;
  let processed = null;
  const tempDir = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  try {
    // 1. Post to premium channel in batches of 10
    await updateMsg(bot, chatId, processingMsg.message_id, '⏳ *Step 1/6:* 💎 Posting batch to premium channel...');
    await postToPremiumChannelBatch(bot, state.videos, caption);

    // 2. Download Preview File
    await updateMsg(bot, chatId, processingMsg.message_id, '⏳ *Step 2/6:* ⬇️ Downloading preview source...');
    
    let sourceFileId = state.previewType.startsWith('custom') ? state.customPreviewFileId : state.videos[0].fileId;
    localVideoPath = path.join(tempDir, `${slug}_source`);
    
    let isDownloaded = false;
    try {
      await downloadTelegramFile(bot, sourceFileId, localVideoPath);
      isDownloaded = true;
    } catch (e) {
      console.log(`Failed to download preview source: ${e.message}`);
    }

    // 3. Generate Preview & Thumb
    await updateMsg(bot, chatId, processingMsg.message_id, '⏳ *Step 3/6:* 🎬 Generating preview & thumb...');
    let thumbnailBase64 = null;
    let thumbExtension = 'jpg';

    if (state.previewType === 'custom_photo') {
      localThumbPath = localVideoPath; // it's already a photo
      thumbnailBase64 = fs.readFileSync(localThumbPath).toString('base64');
      thumbExtension = 'jpg';
    } else if (isDownloaded) {
      try {
        processed = await processVideo(localVideoPath, slug);
        localPreviewPath = processed.previewPath;
        localThumbPath = processed.thumbnailPath;
        thumbnailBase64 = fs.readFileSync(localThumbPath).toString('base64');
        thumbExtension = (path.extname(localThumbPath).replace('.', '') || 'webp').toLowerCase();
      } catch (e) {}
    }

    if (!thumbnailBase64 && state.videos[0].thumbFileId) {
      try {
        const thumbData = await downloadTelegramThumbnail(bot, state.videos[0].thumbFileId, slug);
        thumbnailBase64 = thumbData.base64;
        thumbExtension = thumbData.extension;
        localThumbPath = thumbData.localPath;
      } catch (e) {}
    }

    if (!thumbnailBase64) {
      thumbnailBase64 = generatePlaceholderThumb();
      localThumbPath = await createPlaceholderThumbFile(slug);
    }

    // 4. Publish to Website
    await updateMsg(bot, chatId, processingMsg.message_id, '⏳ *Step 4/6:* 🌐 Publishing watch page...');
    const duration = { duration: '0:00', durationISO: 'PT0S', durationSeconds: 0 };
    await uploadToGithub(slug, caption, description, thumbnailBase64, thumbExtension, duration, { fileId: state.videos[0].fileId }, localPreviewPath);

    // 5. Post to Free Channel
    await updateMsg(bot, chatId, processingMsg.message_id, '⏳ *Step 5/6:* 📢 Posting preview to free channel...');
    await postToFreeChannel(bot, localThumbPath, caption, videoLink, localPreviewPath);

    // 6. Save Metadata
    await updateMsg(bot, chatId, processingMsg.message_id, '⏳ *Step 6/6:* 💾 Saving metadata...');
    const fileIds = state.videos.map(v => v.fileId);
    addVideo(slug, {
      title: caption,
      description,
      slug,
      fileIds,
      duration: 'Batch',
      link: videoLink
    });

    await bot.editMessageText(formatMessage(config.messages.success, { TITLE: caption, LINK: videoLink }), {
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
    });

    cleanupTempFiles(slug);
    delete adminState[chatId];
    try { require('./statsPublisher').publishNow(); } catch (_) {}
  } catch (error) {
    bot.editMessageText(`❌ *Error:*\n${error.message}`, { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: 'Markdown' });
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
      const localPath = path.join(tempDir, `${slug}_thumb.${extension}`);
      const writer = fs.createWriteStream(localPath);
      const protocol = downloadUrl.startsWith('https') ? https : http;
      protocol.get(downloadUrl, (response) => {
        response.pipe(writer);
        response.on('end', () => {
          resolve({ base64: fs.readFileSync(localPath).toString('base64'), extension, localPath });
        });
      });
    } catch (err) { reject(err); }
  });
}

async function createPlaceholderThumbFile(slug) {
  const tempDir = path.join(__dirname, '..', 'temp');
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
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }); } catch (_) {}
}

module.exports = { initAdminHandler, isAdmin };