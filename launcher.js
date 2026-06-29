/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║                 VideoSLK Main Bot — Launcher                 ║
 * ║  Drop this file on your Pterodactyl server as launcher.js    ║
 * ║  Set Startup file to launcher.js                             ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ⚙️ Configurations (Default fallbacks — will be overridden by Panel Startup Env if present)
const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN || '8494437465:AAHPI_ACal9qZdJUFTLP0_XKSbg_XlIhtcQ',
  ADMIN_ID: process.env.ADMIN_ID || '8667419475',
  FREE_CHANNEL_ID: process.env.FREE_CHANNEL_ID || '-1003966168979',
  FREE_CHANNEL_USERNAME: process.env.FREE_CHANNEL_USERNAME || 'ukussafree69',
  MAIN_CHANNEL_ID: process.env.MAIN_CHANNEL_ID || '-1003951563505',
  MAIN_CHANNEL_USERNAME: process.env.MAIN_CHANNEL_USERNAME || 'ukussa69new',
  BACKUP_CHANNEL_ID: process.env.BACKUP_CHANNEL_ID || '-1003903928983',
  BACKUP_CHANNEL_USERNAME: process.env.BACKUP_CHANNEL_USERNAME || 'ukussabackup69',
  PREMIUM_CHANNEL_ID: process.env.PREMIUM_CHANNEL_ID || '-1003649461761',
  PREMIUM_INVITE_LINK: process.env.PREMIUM_INVITE_LINK || 'https://t.me/+BnIZSbt1N2c4ODY1',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || 'YOUR_GITHUB_TOKEN_HERE',
  GITHUB_REPO: process.env.GITHUB_REPO || 'rajivkenzo23/VideoLK',
  GITHUB_BRANCH: process.env.GITHUB_BRANCH || 'main',
  SITE_URL: process.env.SITE_URL || 'https://www.videoslk.eu.cc',
  BOT_LINK: process.env.BOT_LINK || 'https://t.me/ukussa_69_bot',
  GITHUB_REPO_BOT: 'rajivkenzo23/telegram-bot',
  GITHUB_BOT_BRANCH: 'main',
  UNLOCK_HMAC_SECRET: process.env.UNLOCK_HMAC_SECRET || 'b7f8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8',
  UNLOCK_TOKEN_MAX_AGE_SEC: process.env.UNLOCK_TOKEN_MAX_AGE_SEC || '600',
  WHATSAPP_LINK: process.env.WHATSAPP_LINK || 'https://whatsapp.com/channel/0029VbA9drwBadmctNhZGN3S',
  TELEGRAM_API_ID: process.env.TELEGRAM_API_ID || '35481411',
  TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || '5db076b70a26a9e703fcd7c27ea8fc58',
  TELEGRAM_SESSION: process.env.TELEGRAM_SESSION || '',
  STREAMTAPE_LOGIN: process.env.STREAMTAPE_LOGIN || '15a6b6d591b99774fe65',
  STREAMTAPE_KEY: process.env.STREAMTAPE_KEY || 'De0xQO7DjxUkpwx',
  BLOGGER_CLIENT_ID: process.env.BLOGGER_CLIENT_ID || '',
  BLOGGER_CLIENT_SECRET: process.env.BLOGGER_CLIENT_SECRET || '',
  BLOGGER_REFRESH_TOKEN: process.env.BLOGGER_REFRESH_TOKEN || '',
  BLOGGER_BLOG_ID: process.env.BLOGGER_BLOG_ID || '7881938244761000011'
};

const REPO_URL = 'https://github.com/rajivkenzo23/telegram-bot.git';
const BOT_DIR = __dirname;
const ENV_PATH = path.join(BOT_DIR, '.env');

// Restart variables
let restartCount = 0;
const MAX_RESTARTS = 10;
const RESTART_WINDOW = 60000;
let lastRestartTime = Date.now();

function log(msg) { console.log(`[Launcher] ${msg}`); }
function err(msg) { console.error(`[Launcher] ❌ ${msg}`); }

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });
  if (result.error) throw new Error(`${cmd} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${cmd} exited with code ${result.status}`);
}

function cloneOrPull() {
  log('Checking git repository status...');
  if (!fs.existsSync(path.join(BOT_DIR, '.git'))) {
    log('Initializing new Git repository...');
    run('git', ['init'], BOT_DIR);
    run('git', ['remote', 'add', 'origin', REPO_URL], BOT_DIR);
  } else {
    // Update remote URL in case it changed
    try {
      run('git', ['remote', 'set-url', 'origin', REPO_URL], BOT_DIR);
    } catch (_) {}
  }

  log('Pulling latest files from GitHub...');
  try {
    run('git', ['fetch', 'origin', 'main'], BOT_DIR);
    run('git', ['reset', '--hard', 'origin/main'], BOT_DIR);
    log('Files updated successfully.');
  } catch (e) {
    err(`Git update failed: ${e.message}`);
  }
}

function writeEnv() {
  log('Writing configuration to .env file...');
  let existing = {};

  // Read existing .env so user-set values are preserved
  if (fs.existsSync(ENV_PATH)) {
    try {
      const content = fs.readFileSync(ENV_PATH, 'utf8');
      content.split('\n').forEach(line => {
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) return;
        const k = line.slice(0, eqIdx).trim();
        let v = line.slice(eqIdx + 1).trim();
        // Strip surrounding quotes if present
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (k) existing[k] = v;
      });
    } catch (_) {}
  }

  // Merge: existing .env values WIN over CONFIG defaults
  // This means any value the user manually set is never overwritten
  const merged = { ...CONFIG, ...existing };

  const lines = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  fs.writeFileSync(ENV_PATH, lines + '\n', 'utf8');
  log('.env file updated (existing values preserved).');
}

function installDeps() {
  log('Installing npm dependencies...');
  // --ignore-scripts skips native C++ builds (bufferutil/utf-8-validate)
  // which fail on low-disk servers. Both have pure-JS fallbacks that work fine.
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], BOT_DIR);
  log('Dependencies installed successfully.');
}

function startBot() {
  log('Starting VideoSLK main bot process...');
  const child = spawn('node', ['index.js'], {
    cwd: BOT_DIR,
    stdio: 'inherit',
    shell: false
  });

  child.on('error', (error) => {
    err(`Failed to start bot process: ${error.message}`);
    scheduleRestart();
  });

  child.on('exit', (code, signal) => {
    if (code === 0) {
      log('Bot exited cleanly (code 0).');
      return;
    }
    err(`Bot process exited with code ${code} and signal ${signal}`);
    scheduleRestart();
  });
}

function scheduleRestart() {
  const now = Date.now();
  if (now - lastRestartTime > RESTART_WINDOW) {
    restartCount = 0;
  }
  lastRestartTime = now;
  restartCount++;

  if (restartCount > MAX_RESTARTS) {
    err(`Bot has crashed ${MAX_RESTARTS} times in ${RESTART_WINDOW / 1000}s. Stopping.`);
    process.exit(1);
  }

  const delayMs = Math.min(3000 * restartCount, 30000);
  log(`Restarting bot in ${delayMs / 1000}s...`);
  setTimeout(startBot, delayMs);
}

function main() {
  cloneOrPull();
  writeEnv();
  installDeps();
  startBot();
}

main();
