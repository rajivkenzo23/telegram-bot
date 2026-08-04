/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║                 VideoSLK Main Bot — Launcher                 ║
 * ║  Upload this file manually to your Pterodactyl panel         ║
 * ║  Set Startup file to: *.js                                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  BOT_TOKEN: '8494437465:AAHPI_ACal9qZdJUFTLP0_XKSbg_XlIhtcQ',
  ADMIN_ID: '8667419475',
  FREE_CHANNEL_ID: '-1003966168979',
  FREE_CHANNEL_USERNAME: 'ukussafree69',
  MAIN_CHANNEL_ID: '-1003951563505',
  MAIN_CHANNEL_USERNAME: 'ukussa69new',
  BACKUP_CHANNEL_ID: '-1003903928983',
  BACKUP_CHANNEL_USERNAME: 'ukussabackup69',
  PREMIUM_CHANNEL_ID: '-1003649461761',
  PREMIUM_INVITE_LINK: 'https://t.me/+BnIZSbt1N2c4ODY1',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GITHUB_REPO: 'rajivkenzo23/VideoLK',
  GITHUB_BRANCH: 'main',
  SITE_URL: 'https://www.videoslk.eu.cc',
  BOT_LINK: 'https://t.me/ukussa_69_bot',
  GITHUB_REPO_BOT: 'rajivkenzo23/telegram-bot',
  GITHUB_BOT_BRANCH: 'main',
  UNLOCK_HMAC_SECRET: 'b7f8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8',
  UNLOCK_TOKEN_MAX_AGE_SEC: '600',
  WHATSAPP_LINK: 'https://whatsapp.com/channel/0029VbA9drwBadmctNhZGN3S',
  TELEGRAM_API_ID: '35481411',
  TELEGRAM_API_HASH: '5db076b70a26a9e703fcd7c27ea8fc58',
  TELEGRAM_SESSION: '1BQANOTEuMTA4LjU2LjE5MwG7OZEYzphbgI3305wnau4jEWN/Lc6/aOS1T5TmEKqMDIJU20HwT+bx0dZVXX3eUkJllqMVHXYlGnlnWr67mnNfAmjRU2IGk5kJt4A3tGyWB9AJq5anmJmIydLXKvXn8Xfycl9sNIHZjTy7nEa9+S95kCmVk3ZOnPb/MVlXu3voUrBf5bmzvDBPmW0fIsutDaV2UzqcF6QvVjHCNQ4s47VMkVIEhYQRVHjBG+JD/tYwy4kNMgNE8P7Tk98Gr1S9XKsfzRJL8BFOzzF1PvYQcaJquFVz7+2Mqdck61XlDBZWQgMO/nt0BHrJW4XfYy7T+x2Bddz7H6H0zcMcMNYgufQzFg==',
  STREAMTAPE_LOGIN: '15a6b6d591b99774fe65',
  STREAMTAPE_KEY: 'De0xQO7DjxUkpwx',
  CATBOX_USERHASH: '6613486ab0dbb459905e71967',
  IMGCHEST_TOKEN: 'TNqFonuXjnxDbfr3Z5Vr4kjnZTCV1B3U3jE6NH76b40aee70',
  SUB2UNLOCK_API_TOKEN: '1928ea306c31d979f4e10214f7f83b5ee586eaf2'
};

const REPO_URL = 'https://github.com/rajivkenzo23/telegram-bot.git';
const BOT_DIR  = __dirname;
const ENV_PATH = path.join(BOT_DIR, '.env');

let restartCount   = 0;
const MAX_RESTARTS = 10;
const RESTART_WINDOW = 60000;
let lastRestartTime  = Date.now();

function log(msg) { console.log(`[Launcher] ${msg}`); }
function err(msg) { console.error(`[Launcher] ❌ ${msg}`); }

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });
  if (result.error) throw new Error(`${cmd} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${cmd} exited with code ${result.status}`);
}

function cloneOrPull() {
  log('Checking git repository...');
  if (!fs.existsSync(path.join(BOT_DIR, '.git'))) {
    log('No git repo found — initialising...');
    run('git', ['init'], BOT_DIR);
    run('git', ['remote', 'add', 'origin', REPO_URL], BOT_DIR);
  } else {
    try { run('git', ['remote', 'set-url', 'origin', REPO_URL], BOT_DIR); } catch (_) {}
  }

  log('Pulling latest code from GitHub...');
  try {
    run('git', ['fetch', 'origin', 'main'], BOT_DIR);
    run('git', ['clean', '-fd'], BOT_DIR);
    run('git', ['reset', '--hard', 'origin/main'], BOT_DIR);
    run('git', ['checkout', '-B', 'main'], BOT_DIR);
    log('Code updated successfully.');
  } catch (e) {
    err(`Git pull failed: ${e.message} — continuing with existing files.`);
  }
}

function writeEnv() {
  log('Merging .env (existing values are never overwritten)...');

  const existing = {};
  if (fs.existsSync(ENV_PATH)) {
    try {
      fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach(line => {
        const eq = line.indexOf('=');
        if (eq === -1) return;
        const k = line.slice(0, eq).trim();
        let v   = line.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (k) existing[k] = v;
      });
    } catch (_) {}
  }

  let added = 0;
  for (const [k, defaultVal] of Object.entries(DEFAULTS)) {
    if (!existing[k] && existing[k] !== '0') {
      existing[k] = defaultVal;
      added++;
    }
  }

  const lines = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\n');
  fs.writeFileSync(ENV_PATH, lines + '\n', 'utf8');

  if (added > 0) {
    log(`.env updated — added ${added} missing key(s). Existing values untouched.`);
  } else {
    log('.env OK — all keys already set, nothing changed.');
  }
}

function installDeps() {
  log('Installing npm dependencies...');
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], BOT_DIR);
  log('Dependencies ready.');
}

function startBot() {
  log('Starting VideoSLK main bot...');
  const child = spawn('node', ['index.js'], {
    cwd: BOT_DIR,
    stdio: 'inherit',
    shell: false,
  });

  child.on('error', error => {
    err(`Failed to start: ${error.message}`);
    scheduleRestart();
  });

  child.on('exit', (code, signal) => {
    if (code === 0) { log('Bot exited cleanly.'); return; }
    err(`Bot exited with code ${code} / signal ${signal}`);
    scheduleRestart();
  });
}

function scheduleRestart() {
  const now = Date.now();
  if (now - lastRestartTime > RESTART_WINDOW) restartCount = 0;
  lastRestartTime = now;
  restartCount++;

  if (restartCount > MAX_RESTARTS) {
    err(`Crashed ${MAX_RESTARTS}x in ${RESTART_WINDOW / 1000}s — stopping.`);
    process.exit(1);
  }

  const delay = Math.min(3000 * restartCount, 30000);
  log(`Restarting in ${delay / 1000}s...`);
  setTimeout(startBot, delay);
}

function main() {
  cloneOrPull();
  writeEnv();
  installDeps();
  startBot();
}

main();
