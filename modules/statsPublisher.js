/* ============================================
   VideoSLK Bot — Stats Publisher
   Periodically publishes a compact stats snapshot to GitHub:
     assets/data/stats.json
   The admin dashboard's /api/admin/stats endpoint reads this file
   to surface bot-side counters (channel deliveries, totals).
   ============================================ */

const { readStore } = require('./dataManager');
const { readChannelStats, listChannels } = require('./channelRegistry');

let _uploadFileFn = null;

function buildSnapshot() {
  const store = readStore();
  const channelStats = readChannelStats();
  const channels = listChannels();

  // Compact per-user stats: only counters, never PII
  const users = store.users || {};
  let premium = 0, withStreak = 0, returningToday = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const u of Object.values(users)) {
    if (u.premium) premium++;
    if ((u.streak || 0) > 0) withStreak++;
    if (u.lastActive && u.lastActive.slice(0, 10) === today) returningToday++;
  }

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      videos: store.stats?.totalVideos || 0,
      users: store.stats?.totalUsers || 0,
      deliveries: store.stats?.totalDeliveries || 0,
      premiumUsers: premium,
      usersWithStreak: withStreak,
      returningToday
    },
    channels: channels.map(c => ({
      id: c.id, ref: c.ref, niche: c.niche, enabled: c.enabled, username: c.username
    })),
    channelStats   // { ref: { total, byDay } }
  };
}

/**
 * Publish stats.json (and a sanitized channels.json mirror) to GitHub.
 * Accepts the uploadFile fn from githubUploader to avoid circular dep at import time.
 */
async function publishStats(uploadFile) {
  try {
    const snap = buildSnapshot();
    const content = JSON.stringify(snap, null, 2);
    await uploadFile('assets/data/stats.json', content, `stats: ${new Date().toISOString().slice(0, 16)}`, false);
    console.log(`   📊 Stats snapshot published (${Object.keys(snap.channelStats || {}).length} refs)`);
  } catch (e) {
    console.error('   ⚠️ Stats publish failed:', e.message);
  }

  // Also mirror channels.json so the bot survives a fresh VPS deploy.
  // Sanitize: drop the env-derived legacy channel (it's reconstructed from .env on next boot).
  try {
    const fs = require('fs');
    const path = require('path');
    const local = path.join(__dirname, '..', 'data', 'channels.json');
    if (fs.existsSync(local)) {
      const raw = fs.readFileSync(local, 'utf8');
      // Only push if non-empty payload
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.channels) && parsed.channels.length > 0) {
        await uploadFile('assets/data/channels.backup.json', raw,
          `channels backup: ${new Date().toISOString().slice(0, 16)}`, false);
      }
    }
  } catch (e) {
    // Soft-fail
  }
}

/**
 * Start a periodic publisher. Returns a cancel fn.
 */
function startPeriodic(uploadFile, intervalMs = 5 * 60 * 1000) {
  _uploadFileFn = uploadFile;
  // Initial publish 30s after boot — gives bot time to settle
  const first = setTimeout(() => publishStats(uploadFile), 30_000);
  const tick = setInterval(() => publishStats(uploadFile), intervalMs);
  return () => { clearTimeout(first); clearInterval(tick); };
}

function publishNow() {
  if (!_uploadFileFn) return;
  return publishStats(_uploadFileFn);
}

module.exports = { startPeriodic, publishStats, publishNow, buildSnapshot };
