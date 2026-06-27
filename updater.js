/* ============================================
   VideoSLK Bot — Auto Updater
   Pulls latest bot files from GitHub
   Restarts bot when new commit detected
   ============================================ */

const https = require('https');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BOT_DIR = fs.existsSync(path.join(__dirname, 'bot', 'index.js')) ? path.join(__dirname, 'bot') : __dirname;
require('dotenv').config({ path: path.join(BOT_DIR, '.env') });

const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const GITHUB_REPO    = process.env.GITHUB_REPO_BOT    || 'rajivkenzo23/telegram-bot';
const GITHUB_BRANCH  = process.env.GITHUB_BOT_BRANCH  || 'main';
const CHECK_INTERVAL = 5 * 60 * 1000; // check every 5 minutes

let lastCommitSHA = null;
let botProcess    = null;

// ===== Get Latest Commit SHA from GitHub =====
function getLatestCommitSHA() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`,
      method: 'GET',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'VideoSLK-Updater/1.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.sha) {
            resolve(parsed.sha);
          } else {
            reject(new Error('No SHA in response: ' + data.substring(0, 200)));
          }
        } catch (e) {
          reject(new Error('Parse error: ' + e.message));
        }
      });
    });

    req.on('error', err => reject(err));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('GitHub API timeout'));
    });

    req.end();
  });
}

// ===== Pull Latest Files from GitHub =====
function pullLatestFiles() {
  console.log('📥 Pulling latest files from GitHub...');

  try {
    const gitDir = path.join(__dirname, '.git');

    if (!fs.existsSync(gitDir)) {
      console.log('   🔧 Initializing git repo...');
      execSync('git init', { cwd: __dirname, stdio: 'pipe' });
      execSync(
        `git remote add origin https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`,
        { cwd: __dirname, stdio: 'pipe' }
      );
    } else {
      // Update remote URL in case token changed
      try {
        execSync(
          `git remote set-url origin https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`,
          { cwd: __dirname, stdio: 'pipe' }
        );
      } catch (_) {}
    }

    execSync(`git fetch origin ${GITHUB_BRANCH}`, {
      cwd: __dirname,
      stdio: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });

    execSync(`git reset --hard origin/${GITHUB_BRANCH}`, {
      cwd: __dirname,
      stdio: 'pipe'
    });

    console.log('   ✅ Files updated from GitHub');

    // Install any new dependencies
    if (fs.existsSync(path.join(BOT_DIR, 'package.json'))) {
      console.log('   📦 Installing dependencies...');
      execSync('npm install --production', {
        cwd: BOT_DIR,
        stdio: 'pipe'
      });
      console.log('   ✅ Dependencies installed');
    }

    return true;
  } catch (e) {
    console.error('   ❌ Pull failed:', e.message);
    return false;
  }
}

// ===== Start Bot Process =====
async function startBot() {
  if (botProcess) {
    console.log('🛑 Stopping old bot process...');
    return new Promise((resolve) => {
      botProcess.once('exit', () => {
        console.log('   ✅ Old process stopped');
        botProcess = null;
        resolve(spawnBot());
      });
      try { botProcess.kill('SIGTERM'); } catch (_) { resolve(spawnBot()); }
      
      // Force kill after 10s if it won't stop
      setTimeout(() => {
        if (botProcess) {
          try { botProcess.kill('SIGKILL'); } catch (_) {}
        }
      }, 10000);
    });
  } else {
    return spawnBot();
  }
}

function spawnBot() {
  console.log('🚀 Starting bot (index.js)...');

  botProcess = spawn('node', ['index.js'], {
    cwd: BOT_DIR,
    stdio: 'inherit',
    env: process.env
  });

  botProcess.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && signal !== 'SIGKILL') {
      console.log(`⚠️  Bot exited (code ${code}). Restarting in 5s...`);
      setTimeout(startBot, 5000);
    }
  });

  botProcess.on('error', (err) => {
    console.error('❌ Bot process error:', err.message);
    setTimeout(startBot, 5000);
  });

  console.log(`✅ Bot started (PID: ${botProcess.pid})`);
  return botProcess;
}

// ===== Check for Updates =====
async function checkForUpdates() {
  try {
    const latestSHA = await getLatestCommitSHA();

    if (lastCommitSHA === null) {
      console.log(`📌 Current commit: ${latestSHA.substring(0, 7)}`);
      lastCommitSHA = latestSHA;
      return false;
    }

    if (latestSHA !== lastCommitSHA) {
      console.log(`\n🔄 New commit detected!`);
      console.log(`   Old: ${lastCommitSHA.substring(0, 7)}`);
      console.log(`   New: ${latestSHA.substring(0, 7)}`);
      lastCommitSHA = latestSHA;
      return true;
    }

    return false;
  } catch (e) {
    console.error('⚠️  Update check failed:', e.message);
    return false;
  }
}

// ===== Main =====
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     🔄 VideoSLK — Auto Updater          ║');
  console.log(`║  Repo  : ${GITHUB_REPO.padEnd(32)}║`);
  console.log(`║  Branch: ${GITHUB_BRANCH.padEnd(32)}║`);
  console.log(`║  Check : every ${CHECK_INTERVAL / 60000} min                    ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Pull on startup
  pullLatestFiles();

  // Record current SHA
  await checkForUpdates();

  // Start the bot
  startBot();

  // Periodic update check
  setInterval(async () => {
    const ts = new Date().toLocaleTimeString();
    console.log(`\n🔍 [${ts}] Checking for updates...`);

    const hasUpdate = await checkForUpdates();

    if (hasUpdate) {
      console.log('🔄 Pulling new files and restarting bot...');
      const pulled = pullLatestFiles();
      if (pulled) {
        startBot();
      }
    } else {
      console.log('   ✅ Up to date');
    }
  }, CHECK_INTERVAL);
}

// ===== Shutdown =====
function shutdown(signal) {
  console.log(`\n🛑 ${signal} received — updater shutting down...`);
  if (botProcess) {
    try { botProcess.kill('SIGTERM'); } catch (_) {}
  }
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('❌ Updater uncaught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Updater unhandled rejection:', reason);
});

main().catch(console.error);
