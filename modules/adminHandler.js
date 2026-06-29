const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const axios = require('axios');
const { config, formatMessage } = require('../config');
const { generateCaption, generateSlug, generateDescription } = require('./captionGenerator');
const { addVideo } = require('./dataManager');
const { downloadTelegramFile } = require('./telegramDownloader');
const { postToPremiumChannelBatch, postToFreeChannel } = require('./channelPoster');

const adminState = {};

function isAdmin(userId) {
  return userId === config.adminId;
}

function sendMainKeyboard(bot, chatId, text = "👋 Welcome back, Admin. What would you like to do?") {
  bot.sendMessage(chatId, text, {
    reply_markup: {
      keyboard: [
        [{ text: '📤 Upload Files' }, { text: '📊 Stats' }],
        [{ text: '🔧 Fix Thumbnails' }]
      ],
      resize_keyboard: true
    }
  });
}

function initAdminHandler(bot, processVideo, uploadToGithub) {
  // Admin Start Keyboard
  bot.onText(/^\/start$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    delete adminState[msg.chat.id];
    sendMainKeyboard(bot, msg.chat.id);
  });

  bot.on('message', async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const chatId = msg.chat.id;
    const text = msg.text;

    // Trigger Upload
    if (text === '📤 Upload Files' || text === '/upload') {
      adminState[chatId] = { step: 'collecting', videos: [], statusMsgId: null };
      const m = await bot.sendMessage(chatId, "📥 Send me your videos (Batch supported).\nWhen you are finished, click 'Done Uploading'.", {
        reply_markup: {
          keyboard: [[{ text: '✅ Done Uploading' }], [{ text: '❌ Cancel' }]],
          resize_keyboard: true
        }
      });
      adminState[chatId].statusMsgId = m.message_id;
      return;
    }

    // Cancel Upload
    if (text === '❌ Cancel') {
      delete adminState[chatId];
      sendMainKeyboard(bot, chatId, '❌ Upload cancelled.');
      return;
    }

    // Fix Thumbnails
    if (text === '🔧 Fix Thumbnails' || text === '/fix_thumbs') {
      if (adminState[chatId]) {
        bot.sendMessage(chatId, "⚠️ Another action is in progress. Please cancel or finish it first.");
        return;
      }
      adminState[chatId] = { step: 'fixing_thumbnails' };
      
      try {
        const { fixThumbnails } = require('../scripts/fixThumbnails');
        
        let logBuffer = [];
        let lastUpdate = 0;
        let statusMsg = await bot.sendMessage(chatId, "⏳ *Starting thumbnail repair process...*", { parse_mode: 'Markdown' });
        
        const logCallback = async (message) => {
          logBuffer.push(message);
          
          const now = Date.now();
          // Update the Telegram message every 3 seconds to avoid rate limits
          if (now - lastUpdate > 3000) {
            lastUpdate = now;
            try {
              // Show last 12 lines of logs to keep within message length limits
              const snippet = logBuffer.slice(-12).join('\n');
              await bot.editMessageText(`🔧 *Fixing Thumbnails:*\n\n\`\`\`\n${snippet}\n\`\`\``, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown'
              });
            } catch (e) {
              console.error('Failed to edit status message:', e.message);
            }
          }
        };
        
        await fixThumbnails(bot, logCallback);
        
        // Final update with complete summary
        const finalLogs = logBuffer.slice(-15).join('\n');
        await bot.editMessageText(`✅ *Thumbnail fix complete!*\n\n\`\`\`\n${finalLogs}\n\`\`\``, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown'
        });
        
      } catch (err) {
        bot.sendMessage(chatId, `❌ *Failed to fix thumbnails:*\n${err.message}`, { parse_mode: 'Markdown' });
      } finally {
        delete adminState[chatId];
        sendMainKeyboard(bot, chatId, "✅ Finished thumbnail repair.");
      }
      return;
    }

    // Handle Text in states
    const state = adminState[chatId];
    if (!state) return;

    if (text === '✅ Done Uploading') {
      if (state.step !== 'collecting') return;
      if (state.videos.length === 0) {
        bot.sendMessage(chatId, "❌ You haven't sent any videos!");
        return;
      }
      state.step = 'waiting_caption';
      bot.sendMessage(chatId, `✅ Received ${state.videos.length} videos.\n\nNow, type a custom caption, or click Random.`, {
        reply_markup: {
          keyboard: [[{ text: '🎲 Random Caption' }], [{ text: '❌ Cancel' }]],
          resize_keyboard: true
        }
      });
      return;
    }

    if (state.step === 'waiting_caption' && text && !text.startsWith('/')) {
      if (text === '🎲 Random Caption') {
        const hint = state.videos[0].fileName || '';
        state.caption = generateCaption(hint);
      } else {
        state.caption = text;
      }
      state.step = 'waiting_preview_choice';
      bot.sendMessage(chatId, `Caption set to: \n*${state.caption}*\n\nNow, how should we handle the preview?`, {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [
            [{ text: '🎬 Auto (Generate clip)' }],
            [{ text: '🖼 Upload Custom Preview' }],
            [{ text: '❌ Cancel' }]
          ],
          resize_keyboard: true
        }
      });
      return;
    }

    if (state.step === 'waiting_preview_choice' && text && !text.startsWith('/')) {
      if (text === '🎬 Auto (Generate clip)') {
        state.previewType = 'auto';
        state.step = 'ready';
        bot.sendMessage(chatId, '✅ Auto preview selected. Starting process...', {
          reply_markup: { remove_keyboard: true }
        });
        await processAdminBatch(bot, chatId, processVideo, uploadToGithub);
      } else if (text === '🖼 Upload Custom Preview') {
        state.step = 'waiting_custom_preview';
        bot.sendMessage(chatId, '🖼 Please send the custom preview image or video now.', {
          reply_markup: {
            keyboard: [[{ text: '❌ Cancel' }]],
            resize_keyboard: true
          }
        });
      }
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
      let fileId, fileSize, thumbFileId, fileName, type;
      if (msg.video) {
        fileId = msg.video.file_id;
        fileSize = msg.video.file_size;
        thumbFileId = msg.video.thumb ? msg.video.thumb.file_id : null;
        fileName = msg.video.file_name || 'video.mp4';
        type = 'video';
      } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('video/')) {
        fileId = msg.document.file_id;
        fileSize = msg.document.file_size;
        thumbFileId = msg.document.thumb ? msg.document.thumb.file_id : null;
        fileName = msg.document.file_name || 'video.mp4';
        type = 'video';
      } else if (msg.photo) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
        fileSize = msg.photo[msg.photo.length - 1].file_size;
        thumbFileId = null;
        fileName = 'photo.jpg';
        type = 'photo';
      } else {
        return; // ignore non-videos/photos during collection
      }

      state.videos.push({ fileId, fileSize, thumbFileId, fileName, type, messageId: msg.message_id });
      
      // Update status message
      try {
        await bot.editMessageText(`📥 Collecting videos...\n✅ Received: ${state.videos.length} videos\n\nSend more or click 'Done Uploading'.`, {
          chat_id: chatId,
          message_id: state.statusMsgId
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
      state.customPreviewMessageId = msg.message_id;
      state.step = 'ready';
      bot.sendMessage(chatId, "✅ Custom preview received. Starting process...", {
        reply_markup: { remove_keyboard: true }
      });
      await processAdminBatch(bot, chatId, processVideo, uploadToGithub);
    }
  }

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
  
  const processingMsg = await bot.sendMessage(chatId, '⏳ *Processing Batch...*\n\n🚀 Starting...', { parse_mode: 'Markdown' });

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
    let sourceMsgId = state.previewType.startsWith('custom') ? state.customPreviewMessageId : state.videos[0].messageId;
    localVideoPath = path.join(tempDir, `${slug}_source`);
    
    let isDownloaded = false;
    try {
      await downloadTelegramFile(bot, sourceFileId, localVideoPath, chatId, sourceMsgId);
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

    const baseSlug = slug;

    // Split state.videos into chunks of 10
    const chunks = [];
    for (let i = 0; i < state.videos.length; i += 10) {
      chunks.push(state.videos.slice(i, i + 10));
    }

    const duration = { duration: '0:00', durationISO: 'PT0S', durationSeconds: 0 };
    let firstVideoLink = '';

    for (let i = 0; i < chunks.length; i++) {
      const isMultiPart = chunks.length > 1;
      const partNum = i + 1;
      const isFinal = (partNum === chunks.length);
      
      let chunkCaption = caption;
      let chunkSlug = baseSlug;

      if (isMultiPart) {
        chunkCaption += ` - Part ${partNum}`;
        if (isFinal) chunkCaption += ' (Final Part)';
        chunkSlug = `${baseSlug}-part-${partNum}`;
      }

      const description = generateDescription(chunkCaption);
      const videoLink = `${config.siteUrl}/watch/${chunkSlug}.html`;
      
      if (i === 0) firstVideoLink = videoLink;

      // 4. Publish to Website & Streamtape
      await updateMsg(bot, chatId, processingMsg.message_id, `⏳ *Step 4/6:* 🌐 Publishing watch page (Part ${partNum}/${chunks.length})...`);
      
      const embedUrls = [];
      const thumbnails = [];
      const firstVideo = chunks[i][0];

      // Main thumbnail for Part 1 (vIdx = 0)
      const mainThumbPath = `assets/thumbs/${chunkSlug}.${thumbExtension || 'jpg'}`;
      thumbnails.push(mainThumbPath);

      for (let vIdx = 0; vIdx < chunks[i].length; vIdx++) {
        const videoFile = chunks[i][vIdx];
        const partNumLabel = `Part ${vIdx + 1}/${chunks[i].length}`;
        
        let videoToUploadPath = null;
        let shouldDeletePath = false;

        // Step A: Download the video file
        if (i === 0 && vIdx === 0 && state.previewType === 'auto' && localVideoPath && fs.existsSync(localVideoPath)) {
          videoToUploadPath = localVideoPath;
          shouldDeletePath = false;
          console.log(`🚀 Reusing local video source file for Part 1 Streamtape upload: ${videoToUploadPath}`);
        } else {
          const fullVideoPath = path.join(tempDir, `${chunkSlug}_part_${vIdx + 1}_full.mp4`);
          try {
            await updateMsg(bot, chatId, processingMsg.message_id, `⏳ *Step 4/6:* ⬇️ Downloading video for Streamtape (${partNumLabel})...`);
            await downloadTelegramFile(bot, videoFile.fileId, fullVideoPath, chatId, videoFile.messageId);
            videoToUploadPath = fullVideoPath;
            shouldDeletePath = true;
          } catch (downloadErr) {
            console.error(`⚠️ Streamtape download failed for part ${vIdx + 1}:`, downloadErr.message);
          }
        }

        // Step B: Upload to Streamtape
        let partEmbedUrl = '';
        if (videoToUploadPath && fs.existsSync(videoToUploadPath)) {
          try {
            await updateMsg(bot, chatId, processingMsg.message_id, `⏳ *Step 4/6:* 🎥 Uploading video to Streamtape (${partNumLabel})...`);
            const uploadRes = await uploadToStreamtape(videoToUploadPath, videoFile.fileName);
            partEmbedUrl = uploadRes.embedUrl;
            embedUrls.push(partEmbedUrl);
          } catch (uploadErr) {
            console.error(`⚠️ Streamtape upload failed for part ${vIdx + 1}:`, uploadErr.message);
            embedUrls.push('');
          } finally {
            if (shouldDeletePath) {
              try { fs.unlinkSync(videoToUploadPath); } catch (_) {}
            }
          }
        } else {
          embedUrls.push('');
        }

        // Step C: Download and upload Part Thumbnail (for vIdx > 0)
        if (vIdx > 0) {
          await updateMsg(bot, chatId, processingMsg.message_id, `⏳ *Step 4/6:* 📸 Processing thumbnail (${partNumLabel})...`);
          const partThumbPath = `assets/thumbs/${chunkSlug}-part-${vIdx + 1}.jpg`;
          let partThumbBase64 = null;
          
          if (videoFile.thumbFileId) {
            try {
              const thumbData = await downloadTelegramThumbnail(bot, videoFile.thumbFileId, `${chunkSlug}-part-${vIdx + 1}`);
              partThumbBase64 = thumbData.base64;
            } catch (e) {
              console.log(`   ⚠️ Failed to download telegram thumb for part ${vIdx + 1}: ${e.message}`);
            }
          }
          
          if (!partThumbBase64 && thumbnailBase64) {
            partThumbBase64 = thumbnailBase64; // Re-use main thumb if telegram thumbnail is missing
          }
          
          if (partThumbBase64) {
            try {
              const { uploadFile } = require('./githubUploader');
              await uploadFile(partThumbPath, partThumbBase64, `Part Thumb: ${chunkSlug} Part ${vIdx + 1}`, true);
              thumbnails.push(partThumbPath);
            } catch (githubErr) {
              console.error(`⚠️ GitHub thumbnail upload failed for part ${vIdx + 1}:`, githubErr.message);
              thumbnails.push(mainThumbPath);
            }
          } else {
            thumbnails.push(mainThumbPath);
          }
        }
      }

      const embedUrlsString = embedUrls.join(',');
      const thumbnailsString = thumbnails.join(',');

      await uploadToGithub(chunkSlug, chunkCaption, description, thumbnailBase64, thumbExtension, duration, { fileId: firstVideo.fileId, embedUrl: embedUrlsString, thumbnailsAll: thumbnailsString }, localPreviewPath);

      // 5. Post to Free Channel
      await updateMsg(bot, chatId, processingMsg.message_id, `⏳ *Step 5/6:* 📢 Posting to free channel (Part ${partNum}/${chunks.length})...`);
      await postToFreeChannel(bot, localThumbPath, chunkCaption, videoLink, localPreviewPath);

      // 6. Save Metadata (Local JSON and Cloudflare D1)
      await updateMsg(bot, chatId, processingMsg.message_id, `⏳ *Step 6/6:* 💾 Saving metadata to D1 (Part ${partNum}/${chunks.length})...`);
      const fileIds = chunks[i].map(v => v.fileId);
      const mediaFiles = chunks[i].map(v => ({ fileId: v.fileId, type: v.type || 'video' }));
      
      // Local Store JSON
      addVideo(chunkSlug, {
        title: chunkCaption,
        description,
        slug: chunkSlug,
        fileIds,
        mediaFiles,
        duration: 'Batch',
        link: videoLink,
        embedUrl: embedUrlsString
      });

      // Cloudflare D1 Database via Pages API
      try {
        const postPayload = {
          id: chunkSlug,
          title: chunkCaption,
          description: description,
          thumbnail: thumbnailsString,
          preview: localPreviewPath ? `assets/previews/${chunkSlug}.mp4` : '',
          duration: 'Batch',
          views: 1500,
          category: detectCategory(chunkCaption),
          tags: ['entertainment', 'viral', 'trending'],
          telegramFileId: firstVideo.fileId,
          embedUrl: embedUrlsString,
          date: new Date().toISOString().split('T')[0]
        };

        const d1Res = await axios.post(`${config.siteUrl}/api/admin/posts`, postPayload, {
          headers: {
            'Authorization': `Bearer ${config.githubToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!d1Res.data || !d1Res.data.ok) {
          console.error("⚠️ Cloudflare D1 rejected metadata:", d1Res.data?.error || 'unknown');
        } else {
          console.log(`✅ Metadata successfully saved to Cloudflare D1 for ${chunkSlug}`);
        }
      } catch (d1Err) {
        console.error("⚠️ Failed to sync metadata to Cloudflare D1:", d1Err.message);
      }
    }

    await bot.editMessageText(formatMessage(config.messages.success, { TITLE: caption, LINK: firstVideoLink }) + `\n\n*Total Parts Published:* ${chunks.length}`, {
      chat_id: chatId,
      message_id: processingMsg.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🌐 View on Website', url: firstVideoLink }],
          [{ text: '🆓 Free Channel', url: `https://t.me/${config.freeChannelUsername}` }],
          [{ text: '💎 Premium Channel', url: config.premiumInviteLink }]
        ]
      }
    });

    cleanupTempFiles(slug);
    delete adminState[chatId];
    sendMainKeyboard(bot, chatId, "✅ Upload process finished successfully.");
    try { require('./statsPublisher').publishNow(); } catch (_) {}
  } catch (error) {
    bot.editMessageText(`❌ *Error:*\n${error.message}`, { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: 'Markdown' });
    cleanupTempFiles(slug);
    delete adminState[chatId];
    sendMainKeyboard(bot, chatId, "❌ Process failed.");
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
        if (response.statusCode !== 200) {
          writer.destroy();
          try { fs.unlinkSync(localPath); } catch (_) {}
          return reject(new Error(`HTTP ${response.statusCode} from Telegram CDN`));
        }
        response.pipe(writer);
        writer.on('finish', () => {
          resolve({ base64: fs.readFileSync(localPath).toString('base64'), extension, localPath });
        });
        writer.on('error', reject);
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

async function downloadTelegramThumbnail(bot, fileId, slug) {
  const tempDir = path.join(__dirname, '../temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const localPath = path.join(tempDir, `${slug}_thumb.jpg`);
  
  try {
    const file = await bot.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
    
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(localPath);
      const protocol = url.startsWith('https') ? https : http;
      protocol.get(url, (res) => {
        if (res.statusCode !== 200) {
          writer.destroy();
          try { fs.unlinkSync(localPath); } catch (_) {}
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(writer);
        writer.on('finish', () => {
          writer.close();
          const buf = fs.readFileSync(localPath);
          const base64 = buf.toString('base64');
          try { fs.unlinkSync(localPath); } catch (_) {} // delete local file
          resolve({ base64 });
        });
        writer.on('error', reject);
      }).on('error', reject);
    });
  } catch (err) {
    console.error(`⚠️ Failed to download telegram thumbnail for ${slug}:`, err.message);
    throw err;
  }
}

async function updateMsg(bot, chatId, msgId, text) {
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }); } catch (_) {}
}

async function uploadToStreamtape(filePath, filename) {
  const login = process.env.STREAMTAPE_LOGIN || '15a6b6d591b99774fe65';
  const key = process.env.STREAMTAPE_KEY || 'De0xQO7DjxUkpwx';

  const getUrlRes = await axios.get(`https://api.streamtape.com/file/ul?login=${login}&key=${key}`);
  if (!getUrlRes.data || getUrlRes.data.status !== 200) {
    throw new Error('Failed to get Streamtape upload URL: ' + (getUrlRes.data?.msg || 'Unknown error'));
  }
  const uploadUrl = getUrlRes.data.result.url;

  const FormData = require('form-data');
  const form = new FormData();
  form.append('file1', fs.createReadStream(filePath), filename);

  const uploadRes = await axios.post(uploadUrl, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });

  if (!uploadRes.data || uploadRes.data.status !== 200) {
    throw new Error('Upload to Streamtape failed: ' + (uploadRes.data?.msg || 'Unknown error'));
  }

  const fileId = uploadRes.data.result.id;
  const embedUrl = `https://streamtape.com/e/${fileId}/`;
  return { fileId, embedUrl };
}

function detectCategory(title) {
  const t = String(title || '').toLowerCase();
  if (t.includes('funny') || t.includes('comedy') || t.includes('joke')) return 'funny';
  if (t.includes('study') || t.includes('edu') || t.includes('learn')) return 'education';
  return 'entertainment';
}

module.exports = { initAdminHandler, isAdmin };