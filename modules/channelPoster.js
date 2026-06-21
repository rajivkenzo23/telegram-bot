/* ============================================
   VideoSLK Bot — Channel Posters
   - Premium channel: full video, silent, no ads
   - Free channel: short preview clip + website link
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
        type: 'video',
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
        await bot.sendVideo(config.premiumChannelId, media[0].media, {
          caption: media[0].caption,
          parse_mode: 'Markdown',
          supports_streaming: true
        });
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
   FREE CHANNEL — short preview clip + website CTA
   Posts preview video if available; falls back to photo.
   ============================================ */
async function postToFreeChannel(bot, localThumbPath, caption, videoLink, localPreviewPath) {
  console.log(`\n📢 Free channel post scheduled`);
  console.log(`   ⏳ Waiting ${FREE_CHANNEL_POST_DELAY_MS / 1000}s for site deployment...`);
  await delay(FREE_CHANNEL_POST_DELAY_MS);

  const channelCaption = generateChannelCaption(caption, videoLink);
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔓 Unlock Full Video', url: videoLink }],
      [{ text: '⭐ Join Premium (No Ads)', url: config.premiumInviteLink }]
    ]
  };

  // 1) Try video preview clip (highest engagement)
  if (localPreviewPath && fs.existsSync(localPreviewPath)) {
    try {
      console.log(`   🎬 Posting preview clip to @${config.freeChannelUsername}`);
      const result = await bot.sendVideo(config.freeChannelId, localPreviewPath, {
        caption: channelCaption,
        parse_mode: 'HTML',
        supports_streaming: true,
        reply_markup: keyboard
      });
      console.log(`   ✅ Free channel preview posted! Msg ID: ${result.message_id}`);
      return { success: true, messageId: result.message_id, type: 'video' };
    } catch (err) {
      console.error(`   ⚠️  Preview video post failed, falling back to photo:`, err.message);
    }
  }

  // 2) Fall back to thumbnail photo
  try {
    if (!localThumbPath || !fs.existsSync(localThumbPath)) {
      throw new Error('Thumbnail file not found');
    }
    const result = await bot.sendPhoto(config.freeChannelId, localThumbPath, {
      caption: channelCaption,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
    console.log(`   ✅ Free channel photo posted! Msg ID: ${result.message_id}`);
    return { success: true, messageId: result.message_id, type: 'photo' };
  } catch (err) {
    console.error(`   ❌ Photo post failed:`, err.message);
  }

  // 3) Final fallback: text-only with link preview
  try {
    const result = await bot.sendMessage(config.freeChannelId, channelCaption, {
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      reply_markup: keyboard
    });
    console.log(`   ✅ Free channel text-only posted.`);
    return { success: true, messageId: result.message_id, type: 'text' };
  } catch (e) {
    console.error(`   ❌ Free text post failed:`, e.message);
    return { success: false, error: e.message };
  }
}

function escapeMd(s) {
  return String(s || '').replace(/([_*`\[\]()~>#+\-=|{}.!])/g, '\\$1').slice(0, 800);
}

/* ============================================
   MULTI-CHANNEL BROADCAST
   Posts the preview clip (or photo fallback) to:
     - every enabled "free" channel from channels.json (incl. legacy env one)
     - the Backup channel (BACKUP_CHANNEL_ID) — automatic mirror, ref=backup
   Each channel gets its own delay + ref-tagged URL for attribution.
   ============================================ */
async function broadcastToFreeChannels(bot, { localThumbPath, caption, videoLink, localPreviewPath }) {
  // Start with the registry's enabled channels...
  const channels = listChannels().filter(c => c.enabled);

  // ...and append the Backup channel automatically if configured.
  if (config.backupChannelId && !channels.find(c => String(c.id) === String(config.backupChannelId))) {
    channels.push({
      id: String(config.backupChannelId),
      username: config.backupChannelUsername || '',
      ref: 'backup',
      niche: 'backup',
      delaySec: 90, // post backup a bit later so it's a true fallback signal
      captionStyle: 'default',
      enabled: true,
      _source: 'env_backup'
    });
  }

  if (channels.length === 0) {
    console.log('   ⚠️  No free channels registered.');
    return { results: [], total: 0, success: 0 };
  }

  console.log(`\n📡 Broadcasting to ${channels.length} channel(s)...`);
  const results = [];

  for (const ch of channels) {
    const refUrl = withRef(videoLink, ch.ref);
    const caption2 = captionForStyle(ch.captionStyle, caption, refUrl);
    // Beautiful button layout — Website is the primary action
    const keyboard = {
      inline_keyboard: [
        [{ text: '🌐 Watch on Website · Site එකේ බලන්න ✨', url: refUrl }],
        [
          { text: '⭐ Premium', url: config.premiumInviteLink },
          { text: '🦅 Main', url: `https://t.me/${config.mainChannelUsername || 'ukussa69new'}` }
        ]
      ]
    };

    // Per-channel staggered delay to avoid all-at-once posts and Telegram flood limits
    const ms = Math.max(0, (ch.delaySec || 0) * 1000);
    if (ms > 0) {
      console.log(`   ⏳ [${ch.ref}] waiting ${ms / 1000}s before post...`);
      await delay(ms);
    }

    // Per-channel post attempt: video → photo → text
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
        parse_mode: 'HTML', disable_web_page_preview: false, reply_markup: keyboard
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

function captionForStyle(style, caption, videoLink) {
  switch ((style || 'default').toLowerCase()) {
    case 'short':
      // Tight one-liner — works well for niche channels with fast-scrolling audiences
      return `🔥 <b>${escapeHtml(caption)}</b>\n👉 ${videoLink}`;
    case 'longform':
      // Verbose — better SEO on Telegram in-app search
      return `🎬 <b>${escapeHtml(caption)}</b>\n\n` +
             `New exclusive video just dropped. Watch the full version free — only takes 2 quick clicks to unlock.\n\n` +
             `🔓 Unlock now: ${videoLink}\n\n` +
             `⭐ Hate ads? Get Premium (no ads, daily new uncut videos)`;
    case 'default':
    default:
      return generateChannelCaption(caption, videoLink);
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  postToFreeChannel,            // legacy single-channel API (kept for compatibility)
  postToPremiumChannel,
  broadcastToFreeChannels
};
