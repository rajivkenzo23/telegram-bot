/* ============================================
   VideoSLK Bot — Force-subscribe gate
   Users must be members of Main + Free + Backup channels before the bot
   will deliver a video. Admin bypasses. /api/unlock token validation
   happens FIRST; only then we run this gate.

   Each channel is configured via:
     - <X>_CHANNEL_ID         (required — numeric, negative-prefixed)
     - <X>_CHANNEL_USERNAME   (required — used in join URL + UI label)
   ============================================ */

const { config } = require('../config');

// In-memory cache so we don't hit getChatMember on every keystroke
const memberCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

// A channel is "joinable" if we have either a public @username OR a private invite link.
function joinUrl(ch) {
  if (ch.inviteLink) return ch.inviteLink;
  if (ch.username) return `https://t.me/${ch.username}`;
  return null;
}

function requiredChannels() {
  return [
    { key: 'main',   id: config.mainChannelId,   username: config.mainChannelUsername,   inviteLink: config.mainChannelInviteLink,   emoji: '🦅', label: 'Main' },
    { key: 'free',   id: config.freeChannelId,   username: config.freeChannelUsername,   inviteLink: config.freeChannelInviteLink,   emoji: '🆓', label: 'Free' },
    { key: 'backup', id: config.backupChannelId, username: config.backupChannelUsername, inviteLink: config.backupChannelInviteLink, emoji: '🛡', label: 'Backup' }
  ].filter(c => c.id && joinUrl(c));   // need ID for membership check + a way to join
}

async function isMember(bot, channelId, userId) {
  const cacheKey = `${channelId}:${userId}`;
  const hit = memberCache.get(cacheKey);
  if (hit && Date.now() < hit.exp) return hit.value;

  try {
    const m = await bot.getChatMember(channelId, userId);
    const ok = m && ['creator', 'administrator', 'member', 'restricted'].includes(m.status);
    memberCache.set(cacheKey, { value: ok, exp: Date.now() + CACHE_TTL_MS });
    return ok;
  } catch (e) {
    // Bot can't see this chat (not added there, or wrong ID) → treat as not-member,
    // but log loudly because the admin needs to fix the setup.
    console.warn(`force-sub: getChatMember(${channelId}, ${userId}) failed:`, e.message);
    return false;
  }
}

/**
 * Returns { ok, missing: [channels...] }.
 * If forceSubscribe is disabled in config, always returns ok=true.
 */
async function checkMembership(bot, userId) {
  if (!config.forceSubscribe) return { ok: true, missing: [], total: 0 };
  const required = requiredChannels();
  if (required.length === 0) return { ok: true, missing: [], total: 0 };

  const results = await Promise.all(required.map(async (ch) => ({
    ch, joined: await isMember(bot, ch.id, userId)
  })));
  const missing = results.filter(r => !r.joined).map(r => r.ch);
  return { ok: missing.length === 0, missing, total: required.length };
}

function buildGatePrompt(missing, callbackData) {
  // callbackData = a value to send back when user clicks "I joined — try again"
  const buttons = missing.map(ch => {
    const label = ch.username
      ? `${ch.emoji} Join ${ch.label} — @${ch.username}`
      : `${ch.emoji} Join ${ch.label} Channel`;
    return [{ text: label, url: joinUrl(ch) }];
  });
  buttons.push([{ text: '✅ I joined — Try again · Join කරා — නැවත try කරන්න', callback_data: callbackData || 'fsub_recheck' }]);

  const text =
    `🔒 *Almost there!* · *ඉතුරු වෙලා!*\n\n` +
    `To use the bot you must first join *all* of our channels.\n` +
    `Bot use කරන්න ඔයාට අපේ සියලුම channels join කරන්න ඕන.\n\n` +
    `👇 Tap each "Join" button below, then tap *"✅ I joined"*:\n` +
    `👇 හැම Join button එකම click කරලා, "*✅ I joined*" click කරන්න:`;

  return { text, reply_markup: { inline_keyboard: buttons } };
}

// Manual cache buster — used after a successful payment or in admin /flushcache
function clearMembershipCache(userId) {
  if (!userId) { memberCache.clear(); return; }
  for (const k of memberCache.keys()) {
    if (k.endsWith(':' + userId)) memberCache.delete(k);
  }
}

module.exports = {
  requiredChannels,
  checkMembership,
  buildGatePrompt,
  clearMembershipCache
};
