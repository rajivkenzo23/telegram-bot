const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const config = {
  botToken: (process.env.BOT_TOKEN || "").trim(),
  adminId: parseInt(process.env.ADMIN_ID, 10),

  // FREE channel: receives 5-8s preview + website link
  freeChannelId: process.env.FREE_CHANNEL_ID,
  freeChannelUsername: process.env.FREE_CHANNEL_USERNAME || 'ukussafree69',
  freeChannelInviteLink: process.env.FREE_CHANNEL_INVITE_LINK || '',

  // MAIN channel: hub for all channel links + announcements (force-subscribe gate)
  mainChannelId: process.env.MAIN_CHANNEL_ID || null,
  mainChannelUsername: process.env.MAIN_CHANNEL_USERNAME || 'ukussa69new',
  mainChannelInviteLink: process.env.MAIN_CHANNEL_INVITE_LINK || '',

  // BACKUP channel: posts the same preview as Free (fallback if Free gets banned)
  backupChannelId: process.env.BACKUP_CHANNEL_ID || null,
  backupChannelUsername: process.env.BACKUP_CHANNEL_USERNAME || 'ukussabackup69',
  backupChannelInviteLink: process.env.BACKUP_CHANNEL_INVITE_LINK || '',

  // PREMIUM channel: auto-receives full video, gated by Telegram Stars subscription
  // Premium is typically a PRIVATE channel — no username, only an invite link.
  premiumChannelId: process.env.PREMIUM_CHANNEL_ID || null,
  premiumChannelUsername: process.env.PREMIUM_CHANNEL_USERNAME || '',
  premiumInviteLink: process.env.PREMIUM_INVITE_LINK || 'https://t.me/+BnIZSbt1N2c4ODY1',
  premiumStarsPrice: parseInt(process.env.PREMIUM_STARS_PRICE || '50', 10),

  // Force-subscribe gate: users must join these channels before /start delivers a video.
  // Defaults to Main + Free + Backup. Set FORCE_SUB=0 to disable entirely.
  forceSubscribe: process.env.FORCE_SUB !== '0',

  // HMAC secret shared with Cloudflare Pages Function (/api/unlock)
  unlockHmacSecret: process.env.UNLOCK_HMAC_SECRET || '',
  unlockTokenMaxAgeSec: parseInt(process.env.UNLOCK_TOKEN_MAX_AGE_SEC || '600', 10),

  // Cloudflare Turnstile (public site key — embedded in HTML)
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',

  githubToken: (process.env.GITHUB_TOKEN || "").trim(),
  githubRepo: process.env.GITHUB_REPO || 'rajivkenzo23/VideoLK',
  githubBranch: process.env.GITHUB_BRANCH || 'main',

  siteUrl: process.env.SITE_URL || 'https://videoslk.eu.cc',
  botLink: process.env.BOT_LINK || 'https://t.me/ukussa_69_bot',
  telegramApiBaseUrl: process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org',

  tempDir: path.join(__dirname, 'temp'),
  dataFile: path.join(__dirname, 'data', 'videoStore.json'),

  messages: {
    welcome:
      '🎬 *VideoSLK — Exclusive Videos*\n\n' +
      'මේ bot එකෙන් exclusive videos unlock කරගන්න!\n\n' +
      '🔥 Watch previews: {{SITE_URL}}\n' +
      '🆓 Free channel: @{{FREE_CHANNEL}}\n\n' +
      '⬇️ Video unlock කරගන්න website එකට යන්න!',

    videoSent:
      '🎬 *ඔබේ Video මෙන්න!*\n\n' +
      '✅ Full video ඉහතින් බලන්න\n\n' +
      '🔥 තව videos බලන්න:\n' +
      '👉 {{SITE_URL}}\n\n' +
      '🆓 Free: @{{FREE_CHANNEL}}',

    noVideo:
      '❌ *Video Not Found*\n\n' +
      'මේ video එක හමු නොවුනා.\n' +
      'Website එකෙන් නැවත try කරන්න!\n\n' +
      '👉 {{SITE_URL}}',

    adminWelcome:
      '🔧 *Admin Panel*\n\n' +
      'Video එකක් upload කරන්න!\n\n' +
      '📋 Commands:\n' +
      '/stats — Statistics\n' +
      '/list — Video list\n' +
      '/broadcast — Message all users\n' +
      '/help — Help',

    askCaption:
      '📝 *Caption එක ලබා දෙන්න*\n\n' +
      'Caption type කරන්න.\n' +
      'Random caption එකක් generate කරන්නම් button click කරන්න.',

    processing:
      '⏳ *Processing...*\n\n' +
      '🖼 Thumbnail downloading...\n' +
      '📤 Website updating...\n' +
      '📢 Free channel posting...\n\n' +
      'මොහොතක් ඉන්න...',

    success:
      '✅ *Video Successfully Added!*\n\n' +
      '🎬 Title: {{TITLE}}\n' +
      '🔗 Link: {{LINK}}\n\n' +
      '🆓 Free channel: ✅\n' +
      '🌐 Website: ✅',

    error:
      '❌ *Error Occurred*\n\n' +
      '{{ERROR}}\n\n' +
      'නැවත try කරන්න.',

    premiumUpsell:
      '⭐ *Want more like this?*\n\n' +
      '🔓 Premium channel = uncut HD videos, NO ads, NEW every day.\n' +
      '💎 Pay once with Telegram Stars — instant access.\n\n' +
      '👉 /premium to unlock',

    premiumInvoice:
      '⭐ *VideoSLK Premium*\n\n' +
      '✅ Unlimited HD videos — no ads, no unlock steps\n' +
      '✅ Exclusive content uploaded daily\n' +
      '✅ Lifetime access to the premium channel\n\n' +
      '💎 Price: {{STARS}} ⭐',

    premiumThankYou:
      '🎉 *Welcome to VideoSLK Premium!*\n\n' +
      '💎 Your premium access is active.\n' +
      '👉 Join the channel here:\n{{INVITE_LINK}}\n\n' +
      'New videos drop daily — bookmark the chat!',

    tokenInvalid:
      '⚠️ *Invalid or expired link*\n\n' +
      'මේ unlock link එක expire වෙලා හෝ වැරදියි.\n' +
      'Website එකේ නැවත 2-click එක try කරන්න:\n' +
      '👉 {{SITE_URL}}',

    rateLimited:
      '⏳ *Slow down!*\n\n' +
      'ඔයා හරිම ඉක්මනින් request කරනවා.\n' +
      'Few seconds wait කරලා try කරන්න.'
  }
};

function validateConfig() {
  const required = [
    'botToken',
    'adminId',
    'freeChannelId',
    'premiumInviteLink',
    'githubToken'
  ];

  const recommended = [
    ['premiumChannelId', 'PREMIUM_CHANNEL_ID — auto-post full video to premium channel'],
    ['mainChannelId', 'MAIN_CHANNEL_ID — required for force-subscribe gate'],
    ['backupChannelId', 'BACKUP_CHANNEL_ID — backup post mirror + force-subscribe gate'],
    ['unlockHmacSecret', 'UNLOCK_HMAC_SECRET — required to validate unlock tokens (anti-bypass)']
  ];
  recommended.forEach(([key, hint]) => {
    if (!config[key]) console.warn(`⚠️  Missing ${hint}`);
  });

  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required config:', missing.join(', '));
    process.exit(1);
  }

  console.log('✅ Configuration validated');
}

function formatMessage(template, vars) {
  let msg = template;
  msg = msg.replace(/\{\{SITE_URL\}\}/g, config.siteUrl);
  msg = msg.replace(/\{\{FREE_CHANNEL\}\}/g, config.freeChannelUsername);

  if (vars) {
    Object.keys(vars).forEach(key => {
      msg = msg.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), vars[key]);
    });
  }

  return msg;
}

module.exports = { config, validateConfig, formatMessage };