/* ============================================
   VideoSLK Bot — Telegram File Downloader
   Supports both:
   1. GramJS MTProto Client (unlimited file size)
   2. Fallback to standard Bot API (20 MB max limit)
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
  if (gramjsClient) return gramjsClient;

  const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const sessionStr = process.env.TELEGRAM_SESSION;

  if (!apiId || !apiHash || !sessionStr || sessionStr === 'YOUR_TELEGRAM_SESSION_HERE') {
    return null;
  }

  try {
    const stringSession = new StringSession(sessionStr);
    gramjsClient = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });
    await gramjsClient.connect();
    console.log("🚀 GramJS User Client connected successfully for main bot downloader!");
    return gramjsClient;
  } catch (err) {
    console.error("❌ Failed to connect GramJS User Client:", err.message);
    
    // Fallback: If session failed (e.g. AUTH_KEY_DUPLICATED), connect as Bot Client using the Bot Token!
    if (err.message.includes('AUTH_KEY_DUPLICATED') || err.message.includes('406') || err.message.includes('session')) {
      console.log("⚠️ Session duplicated or invalid. Initializing GramJS as Bot Client...");
      try {
        gramjsClient = new TelegramClient(new StringSession(""), apiId, apiHash, {
          connectionRetries: 5,
        });
        await gramjsClient.start({
          botToken: config.botToken
        });
        console.log("🚀 GramJS Bot Client fallback connected successfully!");
        return gramjsClient;
      } catch (botErr) {
        console.error("❌ Failed to connect GramJS Bot Client fallback:", botErr.message);
      }
    }
    
    return null;
  }
}

async function downloadTelegramFile(bot, fileId, destPath, chatId = null, messageId = null) {
  try {
    const client = await getGramjsClient();
    if (client && chatId && messageId) {
      if (!client.connected) {
        console.log("📡 GramJS client disconnected. Reconnecting before download...");
        await client.connect();
      }

      let targetChat = chatId;
      // If chatId is the admin ID, the user client sees this chat under the bot's username/peer
      if (Number(chatId) === Number(config.adminId)) {
        targetChat = config.botLink.split('/').pop().replace('@', '');
      }

      console.log(`📡 Downloading via GramJS MTProto client (chat: ${targetChat}, msg: ${messageId})...`);
      let messages = null;
      try {
        messages = await client.getMessages(targetChat, { ids: [messageId] });
      } catch (e) {
        console.warn(`⚠️ GramJS getMessages failed with primary chat, trying fallback to bot username...`);
        const fallbackChat = config.botLink.split('/').pop().replace('@', '');
        if (fallbackChat !== targetChat) {
          messages = await client.getMessages(fallbackChat, { ids: [messageId] });
        } else {
          throw e;
        }
      }

      if (messages && messages.length > 0 && messages[0].media) {
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        await client.downloadMedia(messages[0], {
          outputFile: destPath
        });
        const stats = fs.statSync(destPath);
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
