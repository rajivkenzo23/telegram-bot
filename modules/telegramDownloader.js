/* ============================================
   VideoSLK Bot — Telegram File Downloader
   Streams files via Bot API (20 MB max per Telegram rules)
   ============================================ */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { config } = require('../config');

const TELEGRAM_BOT_MAX_DOWNLOAD = 20 * 1024 * 1024; // 20 MB

function downloadTelegramFile(bot, fileId, destPath) {
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
