/* ============================================
   VideoSLK Bot — Multi-channel Registry
   Manages an arbitrary number of FREE channels.
   The legacy single channel (config.freeChannelId) is included automatically.
   ============================================ */

const fs = require('fs');
const path = require('path');
const { config } = require('../config');

const REGISTRY_PATH = path.join(__dirname, '..', 'data', 'channels.json');

function ensureDir() {
  const dir = path.dirname(REGISTRY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function read() {
  ensureDir();
  if (!fs.existsSync(REGISTRY_PATH)) return { channels: [] };
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { channels: Array.isArray(parsed.channels) ? parsed.channels : [] };
  } catch (e) {
    console.error('channels.json corrupted:', e.message);
    return { channels: [] };
  }
}

function write(data) {
  ensureDir();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2));
}

/**
 * Returns the merged list of channels:
 *  - legacy channel from config (always included, ref='free0')
 *  - extra channels from channels.json (ref='free<N>' or custom)
 *
 * Each channel object:
 * {
 *   id: '-1001234567890',     // numeric Telegram chat id, string-safe
 *   username: 'channelname',  // without @
 *   ref: 'free0',             // short ref code for attribution
 *   niche: 'sinhala',         // free-text label
 *   delaySec: 60,             // post delay relative to publish completion
 *   captionStyle: 'default',  // 'default' | 'short' | 'longform'
 *   enabled: true
 * }
 */
function listChannels() {
  const { channels } = read();
  const base = [];
  if (config.freeChannelId) {
    base.push({
      id: String(config.freeChannelId),
      username: config.freeChannelUsername || '',
      ref: 'free0',
      niche: 'default',
      delaySec: Math.floor(parseInt(process.env.FREE_CHANNEL_POST_DELAY_MS || '60000', 10) / 1000),
      captionStyle: 'default',
      enabled: true,
      _source: 'env'
    });
  }
  const extras = channels.filter(c => c && c.id).map(c => ({
    id: String(c.id),
    username: c.username || '',
    ref: c.ref || `free${Math.floor(Math.random() * 9999)}`,
    niche: c.niche || 'default',
    delaySec: Number.isFinite(c.delaySec) ? c.delaySec : 60,
    captionStyle: c.captionStyle || 'default',
    enabled: c.enabled !== false,
    _source: 'json'
  }));
  return base.concat(extras);
}

function addChannel(channel) {
  if (!channel || !channel.id) throw new Error('channel.id required');
  const data = read();
  // Dedupe: prevent adding the legacy env channel a second time
  if (config.freeChannelId && String(channel.id) === String(config.freeChannelId)) {
    throw new Error('Channel already configured via FREE_CHANNEL_ID env var');
  }
  if (data.channels.find(c => String(c.id) === String(channel.id))) {
    throw new Error('Channel already registered');
  }
  data.channels.push({
    id: String(channel.id),
    username: channel.username || '',
    ref: channel.ref || `free${data.channels.length + 1}`,
    niche: channel.niche || 'default',
    delaySec: Number.isFinite(channel.delaySec) ? channel.delaySec : 60,
    captionStyle: channel.captionStyle || 'default',
    enabled: channel.enabled !== false,
    addedAt: new Date().toISOString()
  });
  write(data);
  return data.channels[data.channels.length - 1];
}

function removeChannel(id) {
  const data = read();
  const before = data.channels.length;
  data.channels = data.channels.filter(c => String(c.id) !== String(id));
  write(data);
  return before !== data.channels.length;
}

function toggleChannel(id, enabled) {
  const data = read();
  const c = data.channels.find(c => String(c.id) === String(id));
  if (!c) return false;
  c.enabled = !!enabled;
  write(data);
  return true;
}

/**
 * Record a channel-attributed delivery for stats.
 */
function recordChannelDelivery(ref) {
  // Best-effort — keep a small counter file
  ensureDir();
  const statsPath = path.join(__dirname, '..', 'data', 'channelStats.json');
  let stats = {};
  if (fs.existsSync(statsPath)) {
    try { stats = JSON.parse(fs.readFileSync(statsPath, 'utf8')); } catch (_) { stats = {}; }
  }
  const today = new Date().toISOString().slice(0, 10);
  if (!stats[ref]) stats[ref] = { total: 0, byDay: {} };
  stats[ref].total += 1;
  stats[ref].byDay[today] = (stats[ref].byDay[today] || 0) + 1;
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
}

function readChannelStats() {
  const statsPath = path.join(__dirname, '..', 'data', 'channelStats.json');
  if (!fs.existsSync(statsPath)) return {};
  try { return JSON.parse(fs.readFileSync(statsPath, 'utf8')); } catch (_) { return {}; }
}

module.exports = {
  listChannels,
  addChannel,
  removeChannel,
  toggleChannel,
  recordChannelDelivery,
  readChannelStats
};
