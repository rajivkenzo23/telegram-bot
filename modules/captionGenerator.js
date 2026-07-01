const { config } = require('../config');

const THEMES = {
  funny: {
    prefixes: ['😂 හිනා වෙන්න', '🤣 බඩ පැලෙන', '🔥 පට්ටම Funny', '👀 මේක බලන්න'],
    suffixes: ['Moment එක! 😂', 'Clip එක බලන්න! 🤣', 'සීන් එක! 🔥'],
    middles: ['මේක බලලා', 'අද Viral වෙන', 'හැමෝම හිනා වෙන']
  },
  cricket: {
    prefixes: ['🏏 ක්‍රිකට් පිස්සන්ට', '🔥 Cricket Fans', '⚡ අමතක නොවන', '💥 සුපිරිම'],
    suffixes: ['සිද්ධිය! 🏏', 'Shot එක! 🔥', 'Moment එක! ⚡'],
    middles: ['ලංකාවේම', 'Internet එක හෙල්ලූ', 'ඊයේ මැච් එකේ']
  },
  viral: {
    prefixes: ['⚡ Viral වෙච්ච', '🔥 සුපිරිම', '😱 ඇදහිය නොහැකි', '🎬 Exclusive'],
    suffixes: ['වීඩියෝව! 🎬', 'දර්ශනය! ⚡', 'අවස්ථාව! 📹', 'සිද්ධිය! 💥'],
    middles: ['මුළු ලෝකෙම', 'සමාජ මාධ්‍ය කැළඹූ', 'හැමෝම හොයන']
  }
};

const defaultTheme = THEMES.viral;

function generateCaption(hint = '') {
  const l = hint.toLowerCase();
  let theme = defaultTheme;

  if (l.includes('funny') || l.includes('හිනා') || l.includes('lol') || l.includes('😂')) theme = THEMES.funny;
  else if (l.includes('cricket') || l.includes('ක්‍රිකට්') || l.includes('match') || l.includes('🏏')) theme = THEMES.cricket;

  const prefix = theme.prefixes[Math.floor(Math.random() * theme.prefixes.length)];
  const middle = theme.middles[Math.floor(Math.random() * theme.middles.length)];
  const suffix = theme.suffixes[Math.floor(Math.random() * theme.suffixes.length)];

  return `${prefix} ${middle} ${suffix}`;
}

// IMPORTANT: slug must be <=30 chars so the HMAC unlock token fits
// in Telegram's 64-char /start parameter (with ref + exp + sig).
const SLUG_MAX_LEN = 30;

function generateSlug(caption) {
  let slug = caption.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{FE0F}]/gu, '');
  slug = slug.replace(/[^\x00-\x7F]/g, '');
  slug = slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (slug.length < 5) {
    const words = ['exclusive', 'viral', 'trending', 'video', 'clip', 'moment', 'funny', 'amazing'];
    slug = `${words[Math.floor(Math.random() * words.length)]}-${words[Math.floor(Math.random() * words.length)]}`;
  }

  const suffix = '-' + Date.now().toString(36).slice(-3);
  // Reserve space for the time-suffix and trim hard at the limit
  const base = slug.slice(0, SLUG_MAX_LEN - suffix.length).replace(/-+$/, '');
  return base + suffix;
}

function generateDescription(caption) {
  const descriptions = [
    `${caption} — Full video unlock කරගන්න website එකට ගිහින් steps follow කරන්න.`,
    `මේ video එක miss කරන්න එපා! ${caption}. Full version එක Telegram bot එකෙන් ගන්න.`,
    `${caption}. Preview බලලා full video එක unlock කරගන්න! 🔓`,
    `Trending video! ${caption}. Website එකෙන් unlock කරගන්න.`
  ];

  return descriptions[Math.floor(Math.random() * descriptions.length)];
}

function generateChannelCaption(caption) {
  const safe = escapeHtml(caption);
  return (
    `🔥 <b>NEW LEAKED VIDEO · අලුත්ම වීඩියෝ එක!</b>\n\n` +
    `🎬 <b>${safe}</b>\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🇬🇧  <b>How to watch:</b>\n` +
    `1️⃣ Click the unlock button below to watch 👇\n` +
    `2️⃣ Join/Subscribe to access the video link!\n\n` +
    `🇱🇰  <b>බලන්නේ කොහොමද:</b>\n` +
    `1️⃣ පහත Button එක click කර unlock කරන්න 👇\n` +
    `2️⃣ Channel එකට join වෙලා වීඩියෝ එක ලබාගන්න!\n` +
    `━━━━━━━━━━━━━━━`
  );
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  generateCaption,
  generateSlug,
  generateDescription,
  generateChannelCaption
};