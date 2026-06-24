/* ==========================================================================
   VideoSLK — Thumbnail Fixer Utility Script
   Fetches the video database from GitHub, checks for missing/placeholder
   thumbnails (161 bytes), downloads the source videos from Telegram, 
   regenerates real thumbnails using FFmpeg, and uploads them to GitHub.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// 1. Load configuration and environment variables
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

const TelegramBot = require('node-telegram-bot-api');
const { fetchExistingVideos, uploadFile } = require('../modules/githubUploader');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'rajivkenzo23/VideoLK';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

if (!BOT_TOKEN) {
    console.error('❌ Error: BOT_TOKEN is missing in .env');
    process.exit(1);
}

if (!process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN === 'YOUR_NEW_GITHUB_TOKEN') {
    console.error('❌ Error: GITHUB_TOKEN is missing or not configured in .env');
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN);

// Ensure temp directory exists
const tempDir = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// 2. Locate FFmpeg binary
let ffmpegPath = 'ffmpeg';
try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
        ffmpegPath = ffmpegStatic;
        console.log(`✅ Using bundled FFmpeg binary: ${ffmpegPath}`);
    }
} catch (e) {
    console.log('⚠️  ffmpeg-static not found, falling back to system ffmpeg');
}

// Helper: HTTP HEAD request to check file size
function getUrlMetadata(url) {
    return new Promise((resolve) => {
        const req = https.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
            resolve({
                statusCode: res.statusCode,
                contentLength: parseInt(res.headers['content-length'] || '0', 10)
            });
        });
        req.on('error', () => resolve({ statusCode: 500, contentLength: 0 }));
        req.on('timeout', () => { req.destroy(); resolve({ statusCode: 500, contentLength: 0 }); });
        req.end();
    });
}

// Helper: Download file from URL
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(destPath);
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                fileStream.close();
                fs.unlinkSync(destPath);
                return reject(new Error(`HTTP status ${res.statusCode}`));
            }
            res.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve();
            });
        }).on('error', (err) => {
            fileStream.close();
            fs.unlinkSync(destPath);
            reject(err);
        });
    });
}

async function run() {
    console.log('🌐 Fetching latest videos database from GitHub...');
    const videosData = await fetchExistingVideos();
    const videos = Object.values(videosData);
    
    if (videos.length === 0) {
        console.log('❌ No videos found in database or failed to fetch videos.js');
        return;
    }

    console.log(`📊 Found ${videos.length} videos in registry. Checking thumbnails...`);
    let fixedCount = 0;
    let failCount = 0;

    for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        if (!video.thumbnail) continue;

        // Check if thumbnail exists and what its size is on GitHub raw CDN
        const thumbUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${video.thumbnail}`;
        const metadata = await getUrlMetadata(thumbUrl);

        const isPlaceholder = metadata.statusCode === 200 && metadata.contentLength === 161;
        const isMissing = metadata.statusCode === 404;

        if (isPlaceholder || isMissing) {
            console.log(`\n🔍 [NEED FIX] "${video.title}"`);
            console.log(`   Status: ${isPlaceholder ? 'Placeholder detected (161 bytes)' : 'Missing from repository (404)'}`);
            
            if (!video.telegramFileId) {
                console.log('   ⚠️ Cannot fix: No telegramFileId associated with this video.');
                continue;
            }

            try {
                console.log('   ⏳ Fetching file details from Telegram...');
                const file = await bot.getFile(video.telegramFileId);
                
                // Bot API limits download to 20MB
                if (file.file_size && file.file_size > 20 * 1024 * 1024) {
                    console.log(`   ⚠️ Cannot fix: Video size (${(file.file_size / 1024 / 1024).toFixed(1)}MB) exceeds Telegram Bot API download limit of 20MB.`);
                    failCount++;
                    continue;
                }

                const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
                const localVideoPath = path.join(tempDir, `${video.id}_temp.mp4`);
                const localThumbPath = path.join(tempDir, `${video.id}_thumb.jpg`);

                console.log('   ⏳ Downloading video file from Telegram...');
                await downloadFile(downloadUrl, localVideoPath);

                console.log('   ⏳ Extracting real thumbnail frame using FFmpeg...');
                try {
                    // Extract frame at 2 seconds (or 0 if video is extremely short)
                    execSync(`"${ffmpegPath}" -y -i "${localVideoPath}" -ss 00:00:02 -vframes 1 "${localThumbPath}"`, { stdio: 'ignore' });
                } catch (ffmpegErr) {
                    console.log('      🔄 Extraction at 2s failed. Retrying at 0s...');
                    execSync(`"${ffmpegPath}" -y -i "${localVideoPath}" -ss 00:00:00 -vframes 1 "${localThumbPath}"`, { stdio: 'ignore' });
                }

                if (!fs.existsSync(localThumbPath)) {
                    throw new Error('FFmpeg failed to output thumbnail image.');
                }

                console.log('   ⏳ Uploading new thumbnail to GitHub...');
                const thumbnailBase64 = fs.readFileSync(localThumbPath).toString('base64');
                await uploadFile(video.thumbnail, thumbnailBase64, `Fix thumb: ${video.id}`, true);
                
                console.log(`   ✅ Success! Thumbnail updated for: ${video.title}`);
                fixedCount++;

                // Cleanup local temp files
                try { fs.unlinkSync(localVideoPath); } catch (_) {}
                try { fs.unlinkSync(localThumbPath); } catch (_) {}
                
            } catch (err) {
                console.error(`   ❌ Failed to fix: ${err.message}`);
                failCount++;
            }
        }
    }

    console.log('\n==================================================');
    console.log(`🎉 Process Finished!`);
    console.log(`   Fixed: ${fixedCount}`);
    console.log(`   Failed/Skipped: ${failCount}`);
    console.log('==================================================');
}

run().catch(console.error);
