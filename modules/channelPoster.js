/* ============================================
   VideoSLK Bot — Channel Posters
   - Premium channel: full video, silent, no ads
   - Free channel: preview/photo + sub2unlock.me Streamtape links
   ============================================ */

const fs = require('fs');
const { config } = require('../config');
const { generateChannelCaption } = require('./captionGenerator');
const { listChannels } = require('./channelRegistry');

const FREE_CHANNEL_POST_DELAY_MS = parseInt(process.env.FREE_CHANNEL_POST_DELAY_MS || '60000', 10);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Append ?ref=<channelRef> to the watch-page URL so we can attribute clicks back to the channel
function withRef(url, ref) {
  if (!ref) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}ref=${encodeURIComponent(ref)}`;
}

/* ============================================
   PREMIUM CHANNEL — full video, silent
   ============================================ */
async function postToPremiumChannelBatch(bot, videos, caption) {
  if (!config.premiumChannelId) {
    console.log('   ⚠️  PREMIUM_CHANNEL_ID not set — skipping premium post');
    return { success: false, skipped: true };
  }

  console.log(`\n💎 Posting FULL video batch to premium channel`);

  // If the batch contains Streamtape links (no fileId), post as text message!
  const isStreamtapeBatch = videos.some(v => v.streamtapeUrl);
  if (isStreamtapeBatch) {
    console.log(`💎 Posting Streamtape links text batch to premium channel`);
    try {
      const linksText = videos.map((v, idx) => `🎬 *Part ${idx + 1}:* ${v.fileName || 'Video'}\n🔗 ${v.streamtapeUrl.replace('/e/', '/v/')}`).join('\n\n');
      const text = `🎬 *${escapeMd(caption)}*\n\n💎 *VideoSLK Premium Links:*\n\n${linksText}`;
      await bot.sendMessage(config.premiumChannelId, text, { parse_mode: 'Markdown' });
      console.log(`   ✅ Premium channel posted text links!`);
      return { success: true, count: 1 };
    } catch (err) {
      console.error(`   ❌ Premium links post failed:`, err.message);
      return { success: false };
    }
  }

  // Split into chunks of 10
  const chunks = [];
  for (let i = 0; i < videos.length; i += 10) {
    chunks.push(videos.slice(i, i + 10));
  }

  let successCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    // Add part label if multiple chunks exist
    let partLabel = chunks.length > 1 ? ` - Part ${i + 1}` : '';
    if (chunks.length > 1 && i === chunks.length - 1) partLabel += ' (Final Part)';
    
    const premiumCaption = 
      `🎬 *${escapeMd(caption)}${partLabel}*\n\n` +
      `💎 VideoSLK Premium — full HD, no ads\n` +
      `🆕 New videos every day`;

    const media = chunk.map((v, index) => {
      const obj = {
        type: v.type || 'video',
        media: v.fileId,
        parse_mode: 'Markdown'
      };
      // Only the first item in the album gets the caption
      if (index === 0) {
        obj.caption = premiumCaption;
      }
      return obj;
    });

    try {
      if (media.length === 1) {
        if (media[0].type === 'photo') {
          await bot.sendPhoto(config.premiumChannelId, media[0].media, {
            caption: media[0].caption,
            parse_mode: 'Markdown'
          });
        } else {
          await bot.sendVideo(config.premiumChannelId, media[0].media, {
            caption: media[0].caption,
            parse_mode: 'Markdown',
            supports_streaming: true
          });
        }
      } else {
        await bot.sendMediaGroup(config.premiumChannelId, media);
      }
      console.log(`   ✅ Premium channel posted! Chunk ${i+1}/${chunks.length}`);
      successCount++;
    } catch (err) {
      console.error(`   ❌ Premium post failed for chunk ${i+1}:`, err.message);
    }

    // Small delay between chunks to prevent flood
    if (i < chunks.length - 1) {
      await delay(2000);
    }
  }
  
  return { success: successCount === chunks.length, count: successCount };
}

/* ============================================
   FREE CHANNEL — legacy compatibility wrapper
   Delegates to the current multi-channel sub2unlock.me broadcaster.
   ============================================ */
async function postToFreeChannel(bot, localThumbPath, caption, videoLink, localPreviewPath) {
  const embedUrls = Array.isArray(videoLink) ? videoLink : [videoLink].filter(Boolean);
  return broadcastToFreeChannels(bot, { localThumbPath, caption, embedUrls, localPreviewPath });
}

function escapeMd(s) {
  return String(s || '').replace(/([_*`\[\]()~>#+\-=|{}.!])/g, '\\$1').slice(0, 800);
}

const axios = require('axios');

async function shortenWithSub2Unlock(destinationUrl) {
  const apiToken = process.env.SUB2UNLOCK_API_TOKEN;
  const watchUrl = destinationUrl.replace('/e/', '/v/');
  const tgjoin = 'https://omg10.com/4/10695679';
  const ytsub1 = 'https://omg10.com/4/10712300';

  if (!apiToken) {
    console.error('⚠️ SUB2UNLOCK_API_TOKEN is not configured; posting raw Streamtape URL.');
    return watchUrl;
  }
  
  const apiUrl = `https://sub2unlock.me/api?api=${apiToken}&url=${encodeURIComponent(watchUrl)}&tgjoin=${encodeURIComponent(tgjoin)}&ytsub1=${encodeURIComponent(ytsub1)}&format=text`;
  
  try {
    const res = await axios.get(apiUrl, { timeout: 8000 });
    if (res.data && res.data.trim()) {
      return res.data.trim();
    }
  } catch (err) {
    console.error(`⚠️ sub2unlock shortening failed for ${watchUrl}:`, err.message);
  }
  return watchUrl;
}

/* ============================================
   MULTI-CHANNEL BROADCAST
   Posts the preview clip (or photo fallback) to:
     - every enabled "free" channel from channels.json (incl. legacy env one)
     - the Backup channel (BACKUP_CHANNEL_ID) — automatic mirror, ref=backup
   ============================================ */
async function broadcastToFreeChannels(bot, { localThumbPath, caption, embedUrls = [], localPreviewPath }) {
  // Start with the registry's enabled channels...
  const channels = listChannels().filter(c => c.enabled);

  // ...and append the Backup channel automatically if configured.
  if (config.backupChannelId && !channels.find(c => String(c.id) === String(config.backupChannelId))) {
    channels.push({
      id: String(config.backupChannelId),
      username: config.backupChannelUsername || '',
      ref: 'backup',
      niche: 'backup',
      delaySec: 90,
      captionStyle: 'default',
      enabled: true,
      _source: 'env_backup'
    });
  }

  if (channels.length === 0) {
    console.log('   ⚠️  No free channels registered.');
    return { results: [], total: 0, success: 0 };
  }

  // Handle links shortening once for the broadcast
  const validEmbedUrls = Array.isArray(embedUrls) ? embedUrls.filter(Boolean) : (embedUrls ? [embedUrls] : []);
  console.log(`   ⏳ Shortening ${validEmbedUrls.length} links with sub2unlock.me...`);
  
  const shortLinks = [];
  for (let idx = 0; idx < validEmbedUrls.length; idx++) {
    const url = validEmbedUrls[idx];
    const shortUrl = await shortenWithSub2Unlock(url);
    shortLinks.push({
      label: validEmbedUrls.length > 1 ? `🔓 Unlock Part ${idx + 1} 🍿` : '🔓 Unlock Video · බලන්න මෙතනින් 🍿',
      url: shortUrl
    });
  }

  console.log(`\n📡 Broadcasting to ${channels.length} channel(s)...`);
  const results = [];

  for (const ch of channels) {
    const caption2 = captionForStyle(ch.captionStyle, caption);
    
    // Create keyboard dynamically for each channel post
    const inlineKeyboard = [];
    for (const item of shortLinks) {
      inlineKeyboard.push([{ text: item.label, url: item.url }]);
    }
    inlineKeyboard.push([
      { text: '⭐ Premium', url: config.premiumInviteLink },
      { text: '🦅 Main', url: `https://t.me/${config.mainChannelUsername || 'ukussa69new'}` }
    ]);
    
    const keyboard = { inline_keyboard: inlineKeyboard };

    // Per-channel staggered delay
    const ms = Math.max(0, (ch.delaySec || 0) * 1000);
    if (ms > 0) {
      console.log(`   ⏳ [${ch.ref}] waiting ${ms / 1000}s before post...`);
      await delay(ms);
    }

    let result = { ref: ch.ref, channelId: ch.id, success: false };

    if (localPreviewPath && fs.existsSync(localPreviewPath)) {
      try {
        const r = await bot.sendVideo(ch.id, localPreviewPath, {
          caption: caption2, parse_mode: 'HTML', supports_streaming: true, reply_markup: keyboard
        });
        result = { ...result, success: true, type: 'video', messageId: r.message_id };
        console.log(`   ✅ [${ch.ref}] preview clip posted (msg ${r.message_id})`);
        results.push(result);
        continue;
      } catch (err) {
        console.error(`   ⚠️  [${ch.ref}] video failed: ${err.message}`);
      }
    }

    if (localThumbPath && fs.existsSync(localThumbPath)) {
      try {
        const r = await bot.sendPhoto(ch.id, localThumbPath, {
          caption: caption2, parse_mode: 'HTML', reply_markup: keyboard
        });
        result = { ...result, success: true, type: 'photo', messageId: r.message_id };
        console.log(`   ✅ [${ch.ref}] photo posted (msg ${r.message_id})`);
        results.push(result);
        continue;
      } catch (err) {
        console.error(`   ⚠️  [${ch.ref}] photo failed: ${err.message}`);
      }
    }

    try {
      const r = await bot.sendMessage(ch.id, caption2, {
        parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard
      });
      result = { ...result, success: true, type: 'text', messageId: r.message_id };
      console.log(`   ✅ [${ch.ref}] text-only posted`);
    } catch (e) {
      console.error(`   ❌ [${ch.ref}] all post types failed: ${e.message}`);
      result.error = e.message;
    }

    results.push(result);
  }

  const success = results.filter(r => r.success).length;
  console.log(`\n   📊 Broadcast complete: ${success}/${channels.length} channels posted`);
  return { results, total: channels.length, success };
}

function captionForStyle(style, caption) {
  switch ((style || 'default').toLowerCase()) {
    case 'short':
      return `🔥 <b>${escapeHtml(caption)}</b>`;
    case 'longform':
      return `🎬 <b>${escapeHtml(caption)}</b>\n\n` +
             `New exclusive video just dropped. Watch the full version free by clicking the link below.\n\n` +
             `⭐ Hate ads? Get Premium (no ads, daily new uncut videos)`;
    case 'default':
    default:
      return generateChannelCaption(caption);
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  postToFreeChannel,            // legacy single-channel API (kept for compatibility)
  postToPremiumChannelBatch,
  broadcastToFreeChannels
};
