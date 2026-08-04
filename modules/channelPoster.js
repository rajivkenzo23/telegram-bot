/* ============================================
   VideoSLK Bot — Channel Posters
   - Premium channel: full video/photo media groups (auto-compressed via FFmpeg if >49MB video / >9.8MB image)
   - Free channel: preview/photo + sub2unlock.me Streamtape & Imgchest links
   ============================================ */

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const FormData = require('form-data');
const { execSync } = require('child_process');
const { config } = require('../config');
const { generateChannelCaption } = require('./captionGenerator');
const { listChannels } = require('./channelRegistry');

const FREE_CHANNEL_POST_DELAY_MS = parseInt(process.env.FREE_CHANNEL_POST_DELAY_MS || '60000', 10);
const PREMIUM_SEND_DELAY_MS = parseInt(process.env.PREMIUM_SEND_DELAY_MS || '2500', 10);
const PREMIUM_MEDIA_GROUP_SIZE = 10;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeMd(s) {
  return String(s || '').replace(/([_*`\[\]()~>#+\-=|{}.!])/g, '\\$1').slice(0, 800);
}

function cleanString(str) {
  if (!str) return '';
  return str
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{FE0F}]/gu, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ============================================
   SUB2UNLOCK LINK SHORTENER
   ============================================ */
async function shortenWithSub2Unlock(destinationUrl) {
  const apiToken = process.env.SUB2UNLOCK_API_TOKEN;
  const watchUrl = destinationUrl.includes('streamtape.com/e/')
    ? destinationUrl.replace('/e/', '/v/')
    : destinationUrl;

  if (!apiToken) {
    console.error('⚠️ SUB2UNLOCK_API_TOKEN is not configured; posting raw URL.');
    return watchUrl;
  }

  const tgjoin = 'https://omg10.com/4/10695679';
  const ytsub1 = 'https://omg10.com/4/10712300';
  const apiUrl = `https://sub2unlock.me/api?api=${encodeURIComponent(apiToken)}&url=${encodeURIComponent(watchUrl)}&tgjoin=${encodeURIComponent(tgjoin)}&ytsub1=${encodeURIComponent(ytsub1)}&format=text`;

  try {
    const res = await axios.get(apiUrl, { timeout: 10000 });
    const text = String(res.data || '').trim();
    if (text) return text;
  } catch (err) {
    console.error(`⚠️ sub2unlock shortening failed for ${watchUrl}:`, err.message);
  }
  return watchUrl;
}

/* ============================================
   IMGCHEST & CATBOX ALBUMS
   ============================================ */
async function createImgchestAlbum(title, imagePaths, groupNumber, totalGroups) {
  const token = process.env.IMGCHEST_TOKEN || '';
  if (!token) return null;

  const chunks = chunkArray(imagePaths, 20);
  let cleanTitle = cleanString(title);
  if (!cleanTitle || cleanTitle.length < 3) cleanTitle = 'Images';

  const firstChunk = chunks[0];
  const form = new FormData();
  form.append('title', totalGroups > 1 ? `${cleanTitle} - Part ${groupNumber}` : cleanTitle);
  form.append('nsfw', 'true');
  form.append('privacy', 'public');

  for (const filePath of firstChunk) {
    form.append('images[]', fs.createReadStream(filePath), path.basename(filePath));
  }

  const res = await axios.post('https://api.imgchest.com/v1/post', form, {
    headers: { ...form.getHeaders(), 'Authorization': `Bearer ${token}` },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 60000
  });

  if (!res.data || !res.data.data?.id) {
    throw new Error(res.data?.message || 'Failed to create Imgchest post');
  }

  const postId = res.data.data.id;

  for (let cIdx = 1; cIdx < chunks.length; cIdx++) {
    const chunk = chunks[cIdx];
    const addForm = new FormData();
    for (const filePath of chunk) {
      addForm.append('images[]', fs.createReadStream(filePath), path.basename(filePath));
    }

    await axios.post(`https://api.imgchest.com/v1/post/${postId}/add`, addForm, {
      headers: { ...addForm.getHeaders(), 'Authorization': `Bearer ${token}` },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60000
    });
    await delay(1000);
  }

  return `https://imgchest.com/p/${postId}`;
}

async function createImgchestAlbums(title, imagePaths) {
  const token = process.env.IMGCHEST_TOKEN || '';
  if (!token || !imagePaths || imagePaths.length === 0) return [];

  const groups = chunkArray(imagePaths, 100);
  const albumUrls = [];

  for (let idx = 0; idx < groups.length; idx++) {
    console.log(`   [Imgchest album ${idx + 1}/${groups.length}] Creating album for ${groups[idx].length} image(s)...`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const albumUrl = await createImgchestAlbum(title, groups[idx], idx + 1, groups.length);
        if (albumUrl) albumUrls.push(albumUrl);
        break;
      } catch (err) {
        const isRateLimit = err.response && err.response.status === 429;
        if (isRateLimit && attempt < 3) {
          const waitMs = attempt * 30000;
          console.warn(`      [Rate Limit 429] Imgchest rate limit hit. Waiting ${waitMs / 1000}s...`);
          await delay(waitMs);
          continue;
        }
        console.warn(`   [Warning] Imgchest album group ${idx + 1} failed: ${err.message}`);
        break;
      }
    }
  }

  return albumUrls;
}

/* ============================================
   VIDEO DURATION HELPER
   ============================================ */
function getVideoDuration(filePath) {
  try {
    try {
      execSync(`ffmpeg -i "${filePath}"`, { stdio: 'pipe' });
    } catch (err) {
      const output = err.stderr ? err.stderr.toString() : '';
      const match = output.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/i);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseFloat(match[3]);
        return hours * 3600 + minutes * 60 + seconds;
      }
    }
  } catch (_) {}
  return null;
}

/* ============================================
   PREMIUM CHANNEL — POST LOCAL FILES / MEDIA GROUPS
   ============================================ */
async function postPremiumFiles(bot, title, imagePaths = [], videoPaths = []) {
  const premiumChannelId = config.premiumChannelId || process.env.PREMIUM_CHANNEL_ID;
  if (!premiumChannelId) {
    console.log('   ⚠️ PREMIUM_CHANNEL_ID not set — skipping premium post');
    return false;
  }

  console.log(`\n💎 Posting media groups to Premium channel (${premiumChannelId})...`);

  const tempFilesToDelete = [];
  const processedFiles = [];

  // 1. Process Images (>9.8MB compressed to under 10MB)
  for (const filePath of imagePaths) {
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    if (size > 9.8 * 1024 * 1024) {
      const filename = path.basename(filePath, path.extname(filePath)) + '.jpg';
      const tempPath = path.join(os.tmpdir(), `img_${Date.now()}_${filename}`);
      console.log(`   [FFmpeg] Image "${path.basename(filePath)}" is ${(size / (1024 * 1024)).toFixed(2)} MB. Compressing...`);
      try {
        const cmd = `ffmpeg -y -i "${filePath}" -vf "scale='min(2560,iw)':-2" -q:v 3 "${tempPath}"`;
        execSync(cmd, { stdio: 'ignore' });
        const newSize = fs.statSync(tempPath).size;
        console.log(`   [FFmpeg] Image compressed to ${(newSize / (1024 * 1024)).toFixed(2)} MB`);
        processedFiles.push({ type: 'image', filePath: tempPath });
        tempFilesToDelete.push(tempPath);
      } catch (err) {
        console.error(`   [FFmpeg] Image compression failed: ${err.message}`);
        processedFiles.push({ type: 'image', filePath });
      }
    } else {
      processedFiles.push({ type: 'image', filePath });
    }
  }

  // 2. Process Videos (>49MB compressed to under 50MB / split into ~45MB HQ clips)
  for (const filePath of videoPaths) {
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    if (size > 49 * 1024 * 1024) {
      const filename = path.basename(filePath);
      const tempPath = path.join(os.tmpdir(), `compressed_${Date.now()}_${filename}`);
      console.log(`   [FFmpeg] Video "${filename}" is ${(size / (1024 * 1024)).toFixed(2)} MB. Compressing...`);
      try {
        const cmd = `ffmpeg -y -i "${filePath}" -vcodec libx264 -crf 28 -preset fast -vf "scale='min(1280,iw)':-2" -acodec aac -b:a 128k "${tempPath}"`;
        execSync(cmd, { stdio: 'ignore' });
        
        let newSize = fs.statSync(tempPath).size;
        if (newSize > 48 * 1024 * 1024) {
          console.log(`   [FFmpeg] Compressed video is ${(newSize / (1024 * 1024)).toFixed(2)} MB. Splitting into ~45MB HQ clips...`);
          const duration = getVideoDuration(tempPath) || getVideoDuration(filePath);
          const targetPartSize = 45 * 1024 * 1024;
          const numParts = Math.ceil(newSize / targetPartSize);
          const segDuration = duration ? Math.max(10, Math.floor(duration / numParts)) : 300;

          const splitTag = `split_${Date.now()}_`;
          const splitPattern = path.join(os.tmpdir(), `${splitTag}%02d.mp4`);
          const splitCmd = `ffmpeg -y -i "${tempPath}" -c copy -map 0 -segment_time ${segDuration} -f segment -reset_timestamps 1 "${splitPattern}"`;
          execSync(splitCmd, { stdio: 'ignore' });

          const splitFiles = fs.readdirSync(os.tmpdir())
            .filter((f) => f.startsWith(splitTag) && f.endsWith('.mp4'))
            .sort()
            .map((f) => path.join(os.tmpdir(), f));

          if (splitFiles.length > 0) {
            console.log(`   [FFmpeg] Split into ${splitFiles.length} clip(s)`);
            for (const sFile of splitFiles) {
              processedFiles.push({ type: 'video', filePath: sFile });
              tempFilesToDelete.push(sFile);
            }
            tempFilesToDelete.push(tempPath);
            continue;
          }
        }

        console.log(`   [FFmpeg] Video compressed to ${(newSize / (1024 * 1024)).toFixed(2)} MB`);
        processedFiles.push({ type: 'video', filePath: tempPath });
        tempFilesToDelete.push(tempPath);
      } catch (err) {
        console.error(`   [FFmpeg] Video compression failed: ${err.message}`);
        processedFiles.push({ type: 'video', filePath });
      }
    } else {
      processedFiles.push({ type: 'video', filePath });
    }
  }

  if (processedFiles.length === 0) return false;

  // 3. Group files into media groups (max 10 items, max 48MB total size per group)
  const groups = [];
  let currentGroup = [];
  let currentSize = 0;

  for (const item of processedFiles) {
    const fileSize = fs.existsSync(item.filePath) ? fs.statSync(item.filePath).size : 0;
    if (
      currentGroup.length >= PREMIUM_MEDIA_GROUP_SIZE ||
      (currentGroup.length > 0 && currentSize + fileSize > 48 * 1024 * 1024)
    ) {
      groups.push(currentGroup);
      currentGroup = [];
      currentSize = 0;
    }
    currentGroup.push(item);
    currentSize += fileSize;
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  console.log(`   Uploading ${processedFiles.length} local file(s) to Premium channel as ${groups.length} media group(s)...`);

  let success = true;
  for (let groupIdx = 0; groupIdx < groups.length; groupIdx++) {
    const group = groups[groupIdx];
    const groupCaption =
      `<b>PREMIUM VIDEO - NO ADS</b>\n\n` +
      `<b>${escapeHtml(title)}</b>\n` +
      `<b>Part ${groupIdx + 1}/${groups.length}</b> - ${videoPaths.length} video(s), ${imagePaths.length} image(s)`;

    const streams = [];
    const media = group.map((item, itemIdx) => {
      const stream = fs.createReadStream(item.filePath);
      streams.push(stream);

      const mediaItem = {
        type: item.type === 'image' ? 'photo' : 'video',
        media: stream
      };
      if (itemIdx === 0) {
        mediaItem.caption = groupCaption;
        mediaItem.parse_mode = 'HTML';
      }
      if (mediaItem.type === 'video') {
        mediaItem.supports_streaming = true;
      }
      return mediaItem;
    });

    try {
      const names = group.map((item) => path.basename(item.filePath)).join(', ');
      console.log(`   [Premium group ${groupIdx + 1}/${groups.length}] Sending ${group.length} item(s): ${names}`);
      await bot.sendMediaGroup(premiumChannelId, media);
      await delay(PREMIUM_SEND_DELAY_MS);
    } catch (err) {
      console.error(`   Premium media group ${groupIdx + 1} failed: ${err.message}`);
      success = false;
      break;
    } finally {
      for (const stream of streams) {
        try { stream.destroy(); } catch (_) {}
      }
    }
  }

  // Cleanup temp compressed files
  for (const tempPath of tempFilesToDelete) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
  }

  if (success) {
    console.log('   Premium channel media groups completed successfully.');
  }
  return success;
}

/* ============================================
   FREE CHANNEL — POST THUMBNAIL + UNLOCK BUTTONS
   ============================================ */
async function postFreeChannel(bot, localThumbPath, title, embedUrls = [], imageAlbumUrls = []) {
  const freeChannelId = config.freeChannelId || process.env.FREE_CHANNEL_ID;
  if (!freeChannelId) {
    console.log('   ⚠️ FREE_CHANNEL_ID not set — skipping free channel post');
    return false;
  }

  console.log('   Creating sub2unlock.me buttons for free channel...');
  const inlineKeyboard = [];

  for (let idx = 0; idx < imageAlbumUrls.length; idx++) {
    const shortUrl = await shortenWithSub2Unlock(imageAlbumUrls[idx]);
    inlineKeyboard.push([{
      text: imageAlbumUrls.length > 1 ? `View Images Set ${idx + 1}` : 'View All Images',
      url: shortUrl
    }]);
  }

  for (let idx = 0; idx < embedUrls.length; idx++) {
    const shortUrl = await shortenWithSub2Unlock(embedUrls[idx]);
    inlineKeyboard.push([{
      text: embedUrls.length > 1 ? `Unlock Part ${idx + 1}` : 'Unlock Video',
      url: shortUrl
    }]);
  }

  const premiumLink = config.premiumInviteLink || 'https://t.me/+BnIZSbt1N2c4ODY1';
  inlineKeyboard.push([{ text: 'Join Premium (No Ads)', url: premiumLink }]);

  const caption =
    `<b>NEW VIDEO</b>\n\n` +
    `<b>${escapeHtml(title)}</b>\n\n` +
    `<b>How to watch:</b>\n` +
    `1. Click an image/video unlock button below.\n` +
    `2. Complete the sponsor step to access the file.\n\n` +
    `Join @${config.freeChannelUsername} for more daily updates!`;

  try {
    if (localThumbPath && fs.existsSync(localThumbPath)) {
      console.log('   Posting thumbnail + unlock buttons to free channel...');
      const stream = fs.createReadStream(localThumbPath);
      try {
        await bot.sendPhoto(freeChannelId, stream, {
          caption,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      } finally {
        try { stream.destroy(); } catch (_) {}
      }
    } else {
      console.log('   Posting text + unlock buttons to free channel...');
      await bot.sendMessage(freeChannelId, caption, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
    }
    console.log('   Free channel post completed.');
    return true;
  } catch (err) {
    console.error(`   Free channel post failed: ${err.message}`);
    return false;
  }
}

/* Legacy wrappers for existing module compatibility */
async function postToPremiumChannelBatch(bot, videos, caption) {
  if (Array.isArray(videos) && videos[0]?.filePath) {
    const images = videos.filter(v => v.type === 'image' || v.type === 'photo').map(v => v.filePath);
    const vids = videos.filter(v => v.type === 'video').map(v => v.filePath);
    return { success: await postPremiumFiles(bot, caption, images, vids) };
  }
  return { success: false };
}

async function broadcastToFreeChannels(bot, { localThumbPath, caption, embedUrls = [] }) {
  const ok = await postFreeChannel(bot, localThumbPath, caption, embedUrls, []);
  return { success: ok ? 1 : 0, total: 1 };
}

module.exports = {
  postFreeChannel,
  postPremiumFiles,
  createImgchestAlbums,
  shortenWithSub2Unlock,
  postToPremiumChannelBatch,
  broadcastToFreeChannels
};
