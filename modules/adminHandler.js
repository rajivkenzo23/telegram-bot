const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { config } = require('../config');
const { generateCaption, generateSlug } = require('./captionGenerator');
const { downloadTelegramFile } = require('./telegramDownloader');
const {
  postFreeChannel,
  postPremiumFiles,
  createImgchestAlbums,
  shortenWithSub2Unlock
} = require('./channelPoster');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const adminState = {};

function isAdmin(userId) {
  return userId === config.adminId;
}

function sendMainKeyboard(bot, chatId, text = "👋 Welcome back, Admin. What would you like to do?") {
  bot.sendMessage(chatId, text, {
    reply_markup: {
      keyboard: [
        [{ text: '📤 Upload Files' }, { text: '📊 Stats' }]
      ],
      resize_keyboard: true
    }
  });
}

function sortedFiles(folderPath, extSet) {
  if (!fs.existsSync(folderPath)) return [];
  return fs.readdirSync(folderPath)
    .filter((name) => extSet.has(path.extname(name).toLowerCase()))
    .sort((a, b) => {
      const aThumb = a.toLowerCase().startsWith('thumbnail') ? 0 : 1;
      const bThumb = b.toLowerCase().startsWith('thumbnail') ? 0 : 1;
      return aThumb - bThumb || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
}

function extractZip(zipPath, destDir) {
  const { execSync } = require('child_process');
  if (process.platform === 'win32') {
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'ignore' });
  } else {
    try {
      execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'ignore' });
    } catch (_) {
      try { execSync(`7z x -y "${zipPath}" -o"${destDir}"`, { stdio: 'ignore' }); } catch (_) {}
    }
  }
  try { fs.unlinkSync(zipPath); } catch (_) {}
}

async function uploadToStreamtape(filePath, filename) {
  const login = process.env.STREAMTAPE_LOGIN;
  const key = process.env.STREAMTAPE_KEY;
  if (!login || !key) {
    throw new Error('STREAMTAPE_LOGIN and STREAMTAPE_KEY are not configured.');
  }

  const getUrlRes = await axios.get(
    `https://api.streamtape.com/file/ul?login=${encodeURIComponent(login)}&key=${encodeURIComponent(key)}`,
    { timeout: 30000 }
  );

  if (!getUrlRes.data || getUrlRes.data.status !== 200 || !getUrlRes.data.result?.url) {
    throw new Error(`Failed to get Streamtape upload URL: ${getUrlRes.data?.msg || 'unknown error'}`);
  }

  const readStream = fs.createReadStream(filePath);
  const form = new FormData();
  form.append('file1', readStream, filename);

  try {
    const uploadRes = await axios.post(getUrlRes.data.result.url, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 0
    });

    if (!uploadRes.data || uploadRes.data.status !== 200 || !uploadRes.data.result?.id) {
      throw new Error(`Upload failed: ${uploadRes.data?.msg || 'unknown error'}`);
    }

    return `https://streamtape.com/e/${uploadRes.data.result.id}/`;
  } finally {
    try { readStream.destroy(); } catch (_) {}
  }
}

async function uploadToStreamtapeWithRetry(filePath, filename, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await uploadToStreamtape(filePath, filename);
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      await new Promise(r => setTimeout(r, attempt * 4000));
    }
  }
  throw lastError;
}

function initAdminHandler(bot) {
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
      const tempBatchDir = path.join(config.tempDir, `batch_${Date.now()}_${msg.from.id}`);
      fs.mkdirSync(tempBatchDir, { recursive: true });

      adminState[chatId] = {
        step: 'collecting',
        batchDir: tempBatchDir,
        statusMsgId: null
      };

      const m = await bot.sendMessage(
        chatId,
        "📥 *Send your videos, images, or .zip archive.*\n\nOnce all files are uploaded, click *Done Uploading*.",
        {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [[{ text: '✅ Done Uploading' }], [{ text: '❌ Cancel' }]],
            resize_keyboard: true
          }
        }
      );
      adminState[chatId].statusMsgId = m.message_id;
      return;
    }

    // Cancel Upload
    if (text === '❌ Cancel') {
      const state = adminState[chatId];
      if (state && state.batchDir && fs.existsSync(state.batchDir)) {
        try { fs.rmSync(state.batchDir, { recursive: true, force: true }); } catch (_) {}
      }
      delete adminState[chatId];
      sendMainKeyboard(bot, chatId, '❌ Upload cancelled.');
      return;
    }

    const state = adminState[chatId];
    if (!state) return;

    if (text === '✅ Done Uploading') {
      if (state.step !== 'collecting') return;

      const videoFiles = sortedFiles(state.batchDir, VIDEO_EXTENSIONS);
      const imageFiles = sortedFiles(state.batchDir, IMAGE_EXTENSIONS);

      if (videoFiles.length === 0 && imageFiles.length === 0) {
        bot.sendMessage(chatId, "❌ You haven't sent any video or image files!");
        return;
      }

      state.step = 'waiting_caption';
      bot.sendMessage(
        chatId,
        `✅ *Batch Received!*\n\n📹 *Videos:* ${videoFiles.length}\n🖼 *Images:* ${imageFiles.length}\n\nNow, type a custom caption, or click *Random Caption*.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [[{ text: '🎲 Random Caption' }], [{ text: '❌ Cancel' }]],
            resize_keyboard: true
          }
        }
      );
      return;
    }

    if (state.step === 'waiting_caption' && text && !text.startsWith('/')) {
      if (text === '🎲 Random Caption') {
        const videoFiles = sortedFiles(state.batchDir, VIDEO_EXTENSIONS);
        const hint = videoFiles[0] || 'video.mp4';
        state.caption = generateCaption(hint);
      } else {
        state.caption = text;
      }

      state.step = 'ready';
      bot.sendMessage(chatId, `✅ Caption set to: *${state.caption}*\n\nStarting automated publishing pipeline...`, {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
      });

      await processAdminBatch(bot, chatId);
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
    if (!state || state.step !== 'collecting') return;

    try {
      if (msg.document && msg.document.file_name && msg.document.file_name.toLowerCase().endsWith('.zip')) {
        const zipPath = path.join(state.batchDir, `archive_${Date.now()}.zip`);
        await updateMsg(bot, chatId, state.statusMsgId, `📥 Downloading zip archive: ${msg.document.file_name}...`);
        await downloadTelegramFile(bot, msg.document.file_id, zipPath, chatId, msg.message_id);
        
        await updateMsg(bot, chatId, state.statusMsgId, `📦 Extracting zip archive...`);
        extractZip(zipPath, state.batchDir);
      } else if (msg.video) {
        const fileName = msg.video.file_name || `video_${Date.now()}.mp4`;
        const destPath = path.join(state.batchDir, fileName);
        await downloadTelegramFile(bot, msg.video.file_id, destPath, chatId, msg.message_id);
      } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('video/')) {
        const fileName = msg.document.file_name || `video_${Date.now()}.mp4`;
        const destPath = path.join(state.batchDir, fileName);
        await downloadTelegramFile(bot, msg.document.file_id, destPath, chatId, msg.message_id);
      } else if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        const destPath = path.join(state.batchDir, `photo_${Date.now()}.jpg`);
        await downloadTelegramFile(bot, photo.file_id, destPath, chatId, msg.message_id);
      } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
        const fileName = msg.document.file_name || `photo_${Date.now()}.jpg`;
        const destPath = path.join(state.batchDir, fileName);
        await downloadTelegramFile(bot, msg.document.file_id, destPath, chatId, msg.message_id);
      }

      const vCount = sortedFiles(state.batchDir, VIDEO_EXTENSIONS).length;
      const iCount = sortedFiles(state.batchDir, IMAGE_EXTENSIONS).length;

      await updateMsg(
        bot,
        chatId,
        state.statusMsgId,
        `📥 *Collecting files...*\n\n📹 *Videos:* ${vCount}\n🖼 *Images:* ${iCount}\n\nSend more files or click *Done Uploading*.`
      );
    } catch (err) {
      console.error(`Media collection error: ${err.message}`);
    }
  }

  // Stats handler
  bot.onText(/^\/stats$|📊 Stats/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const { getStats } = require('./dataManager');
    const stats = getStats();
    await bot.sendMessage(
      msg.chat.id,
      `📊 *Bot Statistics*\n\n` +
      `📹 Total Posts: ${stats.totalVideos}\n` +
      `👥 Total Users: ${stats.totalUsers}\n` +
      `📤 Total Deliveries: ${stats.totalDeliveries}\n\n` +
      `🖥 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB`,
      { parse_mode: 'Markdown' }
    );
  });
}

async function updateMsg(bot, chatId, msgId, text) {
  if (!msgId) return;
  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
  } catch (_) {}
}

async function processAdminBatch(bot, chatId) {
  const state = adminState[chatId];
  if (!state || state.step !== 'ready') return;

  const caption = state.caption;
  const batchDir = state.batchDir;

  const statusMsg = await bot.sendMessage(chatId, `🚀 *Starting Batch Upload Pipeline...*`, { parse_mode: 'Markdown' });
  const statusMsgId = statusMsg.message_id;

  try {
    const videoFiles = sortedFiles(batchDir, VIDEO_EXTENSIONS);
    const imageFiles = sortedFiles(batchDir, IMAGE_EXTENSIONS);
    const videoPaths = videoFiles.map(f => path.join(batchDir, f));
    const imagePaths = imageFiles.map(f => path.join(batchDir, f));

    // 1. Upload videos to Streamtape
    const embedUrls = [];
    if (videoPaths.length > 0) {
      for (let i = 0; i < videoFiles.length; i++) {
        const fName = videoFiles[i];
        const fPath = videoPaths[i];
        await updateMsg(bot, chatId, statusMsgId, `⏳ *Step 1/4:* 🎥 Uploading video to Streamtape (${i + 1}/${videoFiles.length})...\n\`${fName}\``);
        const embedUrl = await uploadToStreamtapeWithRetry(fPath, fName);
        embedUrls.push(embedUrl);
      }
    }

    // 2. Upload images to Imgchest / Catbox
    let imageAlbumUrls = [];
    if (imagePaths.length > 0) {
      await updateMsg(bot, chatId, statusMsgId, `⏳ *Step 2/4:* 🖼 Creating Imgchest album for ${imagePaths.length} image(s)...`);
      imageAlbumUrls = await createImgchestAlbums(caption, imagePaths);
    }

    // 3. Post to Premium Channel
    await updateMsg(bot, chatId, statusMsgId, `⏳ *Step 3/4:* 💎 Processing & posting media groups to Premium channel...`);
    const premiumOk = await postPremiumFiles(bot, caption, imagePaths, videoPaths);

    // 4. Post to Free Channel
    await updateMsg(bot, chatId, statusMsgId, `⏳ *Step 4/4:* 📢 Shortening links & posting to Free channel...`);
    
    // Find cover thumbnail
    let thumbPath = null;
    if (imageFiles.length > 0) {
      thumbPath = imagePaths[0];
    }

    const freeOk = await postFreeChannel(bot, thumbPath, caption, embedUrls, imageAlbumUrls);

    // 5. Complete
    await bot.editMessageText(
      `✅ *Batch Upload & Publishing Complete!*\n\n` +
      `🎬 *Title:* ${caption}\n` +
      `📹 *Videos:* ${videoFiles.length}\n` +
      `🖼 *Images:* ${imageFiles.length}\n\n` +
      `💎 *Premium Channel:* ${premiumOk ? '✅ Sent' : '⚠️ Skipped/Failed'}\n` +
      `📢 *Free Channel:* ${freeOk ? '✅ Posted' : '⚠️ Failed'}`,
      {
        chat_id: chatId,
        message_id: statusMsgId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Free Channel', url: `https://t.me/${config.freeChannelUsername}` }],
            [{ text: '💎 Premium Channel', url: config.premiumInviteLink }]
          ]
        }
      }
    );
  } catch (err) {
    console.error('Batch upload error:', err);
    await updateMsg(bot, chatId, statusMsgId, `❌ *Upload Failed:*\n${err.message}`);
  } finally {
    if (batchDir && fs.existsSync(batchDir)) {
      try { fs.rmSync(batchDir, { recursive: true, force: true }); } catch (_) {}
    }
    delete adminState[chatId];
    sendMainKeyboard(bot, chatId, "✅ Process finished.");
  }
}

module.exports = { initAdminHandler, isAdmin };
