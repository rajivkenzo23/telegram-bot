#!/usr/bin/env node
/* ============================================
   VideoSLK — Smoke Test
   Mocks Telegram + GitHub APIs + ffmpeg and walks the full upload flow.
   Verifies:
     - Module resolution
     - HMAC token round-trip (mint via Pages-Function logic → verify via bot validator)
     - Slug capping & token length ≤64 chars
     - Channel registry add/list/toggle/remove
     - Tag page generator produces valid HTML
     - Stats snapshot builds cleanly
   Run:  node scripts/smoketest.js
   ============================================ */

// Inject stubs for modules that may not be npm-installed locally
const Module = require('module');
const _origResolve = Module._resolveFilename;
const stubs = {
  'dotenv': { config: () => ({}) },
  'node-telegram-bot-api': function () {},
  'fluent-ffmpeg': Object.assign(function () { return { on: () => {}, save: () => {}, run: () => {} }; }, {
    ffprobe: (p, cb) => cb(null, { format: { duration: 30 } }),
    getAvailableFormats: (cb) => cb(null, {})
  })
};
Module._resolveFilename = function (req, parent, ...rest) {
  if (stubs[req]) {
    // Force stubs by routing to a sentinel resolver
    const fake = require.resolve('path'); // any real file
    require.cache[fake] = require.cache[fake]; // no-op
    return req; // returned id; load below in extensions hook
  }
  return _origResolve.call(this, req, parent, ...rest);
};
const _origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (stubs[req]) return stubs[req];
  return _origLoad.call(this, req, parent, ...rest);
};

process.env.BOT_TOKEN = 'TEST:000';
process.env.ADMIN_ID = '1';
process.env.FREE_CHANNEL_ID = '-1001000000001';
process.env.FREE_CHANNEL_USERNAME = 'testfree';
process.env.PREMIUM_CHANNEL_ID = '-1001000000002';
process.env.PREMIUM_CHANNEL_USERNAME = 'testpremium';
process.env.PREMIUM_INVITE_LINK = 'https://t.me/+abc';
process.env.GITHUB_TOKEN = 'ghp_test';
process.env.GITHUB_REPO = 'test/test';
process.env.SITE_URL = 'https://example.test';
process.env.BOT_LINK = 'https://t.me/testbot';
process.env.UNLOCK_HMAC_SECRET = 'a'.repeat(32);

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function log(level, msg) {
  const icon = { ok: '✅', fail: '❌', warn: '⚠️', info: '🧪' }[level] || '•';
  console.log(`${icon} ${msg}`);
}

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; log('ok', name); }
  else { fail++; log('fail', name); }
}

// ===== 1. Module resolution =====
log('info', '--- 1. Module resolution');
let modules = {};
try {
  modules.config = require(path.join(ROOT, 'config'));
  modules.captionGenerator = require(path.join(ROOT, 'modules/captionGenerator'));
  modules.dataManager = require(path.join(ROOT, 'modules/dataManager'));
  modules.channelRegistry = require(path.join(ROOT, 'modules/channelRegistry'));
  modules.unlockToken = require(path.join(ROOT, 'modules/unlockToken'));
  modules.tagPageGenerator = require(path.join(ROOT, 'modules/tagPageGenerator'));
  modules.statsPublisher = require(path.join(ROOT, 'modules/statsPublisher'));
  modules.videoProcessor = require(path.join(ROOT, 'modules/videoProcessor'));
  modules.telegramDownloader = require(path.join(ROOT, 'modules/telegramDownloader'));
  modules.channelPoster = require(path.join(ROOT, 'modules/channelPoster'));
  modules.githubUploader = require(path.join(ROOT, 'modules/githubUploader'));
  log('ok', 'All modules resolved');
  pass++;
} catch (e) {
  log('fail', `Module load failed: ${e.message}`);
  fail++;
  process.exit(1);
}

// ===== 2. Slug capping =====
log('info', '--- 2. Slug capping');
const longCaption = 'this-is-a-very-very-very-long-viral-cricket-funny-video-clip-trending-2026';
const slug = modules.captionGenerator.generateSlug(longCaption);
assert(slug.length <= 30, `slug "${slug}" length ${slug.length} <= 30`);
assert(/^[a-z0-9-]+$/.test(slug), 'slug contains only [a-z0-9-]');
assert(!slug.includes('_'), 'slug has no underscores (required for token format)');

// ===== 3. HMAC token round-trip =====
log('info', '--- 3. HMAC token round-trip');
const secret = process.env.UNLOCK_HMAC_SECRET;
const testSlug = 'test-clip-abc-123';
const testRef = 'free0';
const expSec = Math.floor(Date.now() / 1000) + 600;
const exp36 = expSec.toString(36);

function hexSig(secret, payload, len) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, len);
}

const signedPayload = `${testSlug}|${exp36}|${testRef}`;
const sig = hexSig(secret, signedPayload, 16);
const token = `${testSlug}_${exp36}_${testRef}_${sig}`;

assert(token.length <= 64, `token "${token}" length ${token.length} <= 64`);

const verdict = modules.unlockToken.validateUnlockToken(token);
assert(verdict.ok === true, 'valid token verifies');
assert(verdict.videoId === testSlug, 'recovers videoId');
assert(verdict.ref === testRef, 'recovers ref');

// Tampered
const bad = token.slice(0, -2) + 'xx';
const badVerdict = modules.unlockToken.validateUnlockToken(bad);
assert(badVerdict.ok === false, 'tampered token rejected');

// Expired
const expired = `${testSlug}_${(expSec - 700).toString(36)}_${sig}`;
const expVerdict = modules.unlockToken.validateUnlockToken(expired);
assert(expVerdict.ok === false && expVerdict.reason === 'expired', 'expired token rejected');

// Max-length token
const maxSlug = 'a'.repeat(30);
const maxRef = 'free9999';
const maxPayload = `${maxSlug}|${exp36}|${maxRef}`;
const maxSig = hexSig(secret, maxPayload, 16);
const maxToken = `${maxSlug}_${exp36}_${maxRef}_${maxSig}`;
assert(maxToken.length <= 64, `worst-case token length ${maxToken.length} <= 64`);
const maxVerdict = modules.unlockToken.validateUnlockToken(maxToken);
assert(maxVerdict.ok, 'worst-case token still validates');

// ===== 4. looksLikeToken =====
log('info', '--- 4. looksLikeToken');
assert(modules.unlockToken.looksLikeToken(token), 'classifies real token');
assert(!modules.unlockToken.looksLikeToken('plain-slug-abc'), 'rejects raw slug');
assert(!modules.unlockToken.looksLikeToken(''), 'rejects empty');

// ===== 5. Channel registry CRUD =====
log('info', '--- 5. Channel registry CRUD');
const testDataDir = path.join(ROOT, 'data');
const channelsFile = path.join(testDataDir, 'channels.json');
const channelsBackup = fs.existsSync(channelsFile) ? fs.readFileSync(channelsFile, 'utf8') : null;
// Clean slate
fs.writeFileSync(channelsFile, JSON.stringify({ channels: [] }));

let channels = modules.channelRegistry.listChannels();
assert(channels.length >= 1, `legacy env channel auto-included (got ${channels.length})`);
assert(channels[0].ref === 'free0', 'legacy channel has ref=free0');

modules.channelRegistry.addChannel({ id: '-1009999999999', username: 'test1', niche: 'funny' });
channels = modules.channelRegistry.listChannels();
assert(channels.length === 2, 'addChannel works');
assert(channels[1].username === 'test1', 'channel persisted with username');

modules.channelRegistry.toggleChannel('-1009999999999', false);
channels = modules.channelRegistry.listChannels();
assert(channels[1].enabled === false, 'toggle disables');

const removed = modules.channelRegistry.removeChannel('-1009999999999');
assert(removed === true, 'remove returns true');
channels = modules.channelRegistry.listChannels();
assert(channels.length === 1, 'after remove, only legacy left');

// Restore original channels.json
if (channelsBackup) fs.writeFileSync(channelsFile, channelsBackup);
else try { fs.unlinkSync(channelsFile); } catch (_) {}

// ===== 6. Tag page generator =====
log('info', '--- 6. Tag page generator');
const fakeVideos = {
  'a-slug-1': { id: 'a-slug-1', title: 'Funny test', tags: ['funny', 'viral'], views: 1000, duration: '0:30' },
  'b-slug-2': { id: 'b-slug-2', title: 'Cricket test', tags: ['cricket', 'sports'], views: 500, duration: '1:00' },
  'c-slug-3': { id: 'c-slug-3', title: 'Funny clip 2', tags: ['funny'], views: 200, duration: '0:15' }
};
const tagFiles = modules.tagPageGenerator.generateAllTagPages(fakeVideos);
assert(tagFiles.length === 5, `5 files (4 tag pages + index, got ${tagFiles.length})`);
const funnyPage = tagFiles.find(f => f.path === 'tag/funny.html');
assert(funnyPage && funnyPage.content.includes('Funny test'), 'funny tag page contains video');
assert(funnyPage.content.includes('Funny clip 2'), 'funny tag page contains both funny videos');
const indexFile = tagFiles.find(f => f.path === 'tag/index.html');
assert(indexFile && indexFile.content.includes('Browse by Tag'), 'tag index exists');

// ===== 7. Stats snapshot =====
log('info', '--- 7. Stats snapshot');
const snap = modules.statsPublisher.buildSnapshot();
assert(typeof snap.generatedAt === 'string', 'snapshot has timestamp');
assert(typeof snap.totals === 'object', 'snapshot has totals');
assert(Array.isArray(snap.channels), 'snapshot has channels array');
assert(typeof snap.channelStats === 'object', 'snapshot has channelStats');

// ===== 8. Channel poster broadcast (mock bot) =====
log('info', '--- 8. broadcastToFreeChannels happy path');
const mockBot = {
  callLog: [],
  sendVideo: async function (chatId, file, opts) {
    this.callLog.push({ method: 'sendVideo', chatId, file, opts });
    return { message_id: 1 };
  },
  sendPhoto: async function (chatId, file, opts) {
    this.callLog.push({ method: 'sendPhoto', chatId, file, opts });
    return { message_id: 2 };
  },
  sendMessage: async function (chatId, text, opts) {
    this.callLog.push({ method: 'sendMessage', chatId, text, opts });
    return { message_id: 3 };
  }
};
// Force zero delay for the test
process.env.FREE_CHANNEL_POST_DELAY_MS = '0';
// Need to invalidate require cache so the new env is picked up
delete require.cache[require.resolve(path.join(ROOT, 'modules/channelPoster'))];
const fresh = require(path.join(ROOT, 'modules/channelPoster'));

// Make sure the legacy channel has zero delay too
const fakeChannelsJson = path.join(testDataDir, 'channels.json');
fs.writeFileSync(fakeChannelsJson, JSON.stringify({ channels: [] }));
delete require.cache[require.resolve(path.join(ROOT, 'modules/channelRegistry'))];

(async () => {
  // Create a temp preview file so broadcaster takes the video path
  const tmpDir = path.join(ROOT, 'temp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPreview = path.join(tmpDir, 'smoke_preview.mp4');
  fs.writeFileSync(tmpPreview, 'fake-mp4-bytes');

  const result = await fresh.broadcastToFreeChannels(mockBot, {
    localThumbPath: null,
    caption: 'Smoke test',
    videoLink: 'https://example.test/watch/x.html',
    localPreviewPath: tmpPreview
  });

  fs.unlinkSync(tmpPreview);
  assert(result.success >= 1, `broadcaster posted to at least 1 channel (success=${result.success})`);
  assert(mockBot.callLog.some(c => c.method === 'sendVideo'), 'sendVideo was called');

  // ===== 9. Token format negative tests =====
  log('info', '--- 9. Token format negative tests');
  assert(!modules.unlockToken.validateUnlockToken(null).ok, 'null token rejected');
  assert(!modules.unlockToken.validateUnlockToken('a_b_c').ok, 'malformed sig length rejected');
  assert(!modules.unlockToken.validateUnlockToken('UPPER_lower_test_abcdefghijkl').ok, 'mixed-case slug rejected');

  // ===== Summary =====
  console.log();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  log('fail', `Async block threw: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
