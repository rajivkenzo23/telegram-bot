/* ============================================
   VideoSLK Bot — Telegram File Downloader
   Supports both:
   1. GramJS MTProto Client (unlimited file size up to 2GB)
   2. Fallback to standard Bot API (20 MB limit)
   ============================================ */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { config } = require('../config');
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const TELEGRAM_BOT_MAX_DOWNLOAD = 20 * 1024 * 1024; // 20 MB
let gramjsClient = null;

async function getGramjsClient() {
  if (gramjsClient && gramjsClient.connected) return gramjsClient;

  const apiId = parseInt(process.env.TELEGRAM_API_ID || '35481411', 10);
  const apiHash = process.env.TELEGRAM_API_HASH || '5db076b70a26a9e703fcd7c27ea8fc58';
  const sessionStr = process.env.TELEGRAM_SESSION;
  const botToken = (process.env.BOT_TOKEN || config.botToken || '').trim();

  // Try User Session if available
  if (apiId && apiHash && sessionStr && sessionStr !== 'YOUR_TELEGRAM_SESSION_HERE') {
    try {
      const stringSession = new StringSession(sessionStr);
      gramjsClient = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: false
      });
      await gramjsClient.connect();
      console.log("🚀 GramJS User Client connected successfully for main bot downloader!");
      return gramjsClient;
    } catch (err) {
      console.warn("⚠️ GramJS User Session failed:", err.message);
      gramjsClient = null;
    }
  }

  // Fallback: Connect GramJS using Bot Token over MTProto (bypasses 20MB Bot API limit)
  if (apiId && apiHash && botToken) {
    try {
      console.log("📡 Connecting GramJS Bot Client over MTProto for large file downloading...");
      gramjsClient = new TelegramClient(new StringSession(""), apiId, apiHash, {
        connectionRetries: 5,
        useWSS: false
      });
      await gramjsClient.start({
        botAuthToken: botToken
      });
      console.log("🚀 GramJS Bot Client connected successfully over MTProto (Large downloads enabled)!");
      return gramjsClient;
    } catch (botErr) {
      console.error("❌ Failed to connect GramJS Bot Client fallback:", botErr.message);
      gramjsClient = null;
    }
  }

  return null;
}

async function downloadTelegramFile(bot, fileId, destPath, chatId = null, messageId = null) {
  try {
    const client = await getGramjsClient();
    if (client && chatId && messageId) {
      if (!client.connected) {
        console.log("📡 GramJS client disconnected. Reconnecting before download...");
        await client.connect();
      }

      console.log(`📡 Downloading via GramJS MTProto client (chat: ${chatId}, msg: ${messageId})...`);
      let messages = null;
      try {
        messages = await client.getMessages(chatId, { ids: [messageId] });
      } catch (e) {
        console.warn(`⚠️ GramJS getMessages failed with primary chat, trying fallback to bot username...`);
        const botUsername = (config.botLink || '').split('/').pop().replace('@', '');
        if (botUsername) {
          try {
            messages = await client.getMessages(botUsername, { ids: [messageId] });
          } catch (_) {}
        }
      }

      if (messages && messages.length > 0 && messages[0].media) {
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        await client.downloadMedia(messages[0], {
          outputFile: destPath
        });
        const stats = fs.statSync(destPath);
        console.log(`✅ Downloaded ${(stats.size / 1024 / 1024).toFixed(2)} MB via GramJS MTProto!`);
        return { path: destPath, size: stats.size };
      }
      console.warn("⚠️ Could not locate media via MTProto. Falling back to Bot API.");
    }
  } catch (err) {
    console.warn(`⚠️ GramJS download failed: ${err.message}. Falling back to standard Bot API.`);
  }

  return new Promise(async (resolve, reject) => {
    try {
      const file = await bot.getFile(fileId);
      if (file.file_size && file.file_size > TELEGRAM_BOT_MAX_DOWNLOAD) {
        return reject(new Error(`TOO_LARGE: ${(file.file_size / 1024 / 1024).toFixed(1)}MB exceeds 20MB Bot API limit`));
      }

      const url = `${config.telegramApiBaseUrl}/file/bot${config.botToken}/${file.file_path}`;
      const protocol = url.startsWith('https') ? https : http;

      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const writer = fs.createWriteStream(destPath);
      const req = protocol.get(url, (res) => {
        if (res.statusCode !== 200) {
          writer.destroy();
          try { fs.unlinkSync(destPath); } catch (_) {}
          return reject(new Error(`HTTP ${res.statusCode} from Telegram CDN`));
        }
        res.pipe(writer);
        writer.on('finish', () => writer.close(() => resolve({ path: destPath, size: file.file_size || 0 })));
        writer.on('error', reject);
      });
      req.setTimeout(120000, () => { req.destroy(); reject(new Error('Telegram download timeout')); });
      req.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { downloadTelegramFile, TELEGRAM_BOT_MAX_DOWNLOAD };
