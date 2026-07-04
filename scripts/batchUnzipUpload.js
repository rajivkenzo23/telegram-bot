/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║            VideoSLK Local Zip Extractor & Streamtape         ║
 * ║  Run this script on your PC:                                 ║
 * ║  node scripts/batchUnzipUpload.js                            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * This script will:
 * 1. Look for all .zip files in the "zips_to_upload" folder.
 * 2. Unzip each file using Windows PowerShell (built-in, no npm modules needed).
 * 3. Scan the unzipped files for video files (.mp4, .mkv, .avi, etc.).
 * 4. Upload them to Streamtape using your STREAMTAPE_LOGIN and STREAMTAPE_KEY.
 * 5. Save the output links to "streamtape_links_output.txt" in your bot folder.
 * 6. Clean up the extracted files and move processed zips to a "processed_zips" folder.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');

const BOT_ROOT = path.join(__dirname, '..');
const ZIP_DIR = path.join(BOT_ROOT, 'zips_to_upload');
const PROCESSED_DIR = path.join(BOT_ROOT, 'processed_zips');
const TEMP_DIR = path.join(BOT_ROOT, 'temp', 'unzip_temp');
const OUTPUT_FILE = path.join(BOT_ROOT, 'streamtape_links_output.txt');

const STREAMTAPE_LOGIN = process.env.STREAMTAPE_LOGIN;
const STREAMTAPE_KEY = process.env.STREAMTAPE_KEY;

if (!STREAMTAPE_LOGIN || !STREAMTAPE_KEY) {
  err('STREAMTAPE_LOGIN and STREAMTAPE_KEY must be configured in .env before uploading.');
  process.exit(1);
}

function log(msg) { console.log(`[ZipUploader] ${msg}`); }
function err(msg) { console.error(`[ZipUploader] ❌ ${msg}`); }

// Ensure directories exist
if (!fs.existsSync(ZIP_DIR)) fs.mkdirSync(ZIP_DIR, { recursive: true });
if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

async function uploadToStreamtape(filePath, filename) {
  log(`Starting Streamtape upload for: ${filename}`);
  
  // Get Upload URL
  const getUrlUrl = `https://api.streamtape.com/file/ul?login=${STREAMTAPE_LOGIN}&key=${STREAMTAPE_KEY}`;
  const getUrlRes = await axios.get(getUrlUrl);
  if (!getUrlRes.data || getUrlRes.data.status !== 200) {
    throw new Error('Failed to get Streamtape upload URL: ' + (getUrlRes.data?.msg || 'Unknown error'));
  }
  const uploadUrl = getUrlRes.data.result.url;

  // Perform upload using FormData
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file1', fs.createReadStream(filePath), filename);

  const uploadRes = await axios.post(uploadUrl, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });

  if (!uploadRes.data || uploadRes.data.status !== 200) {
    throw new Error('Upload to Streamtape failed: ' + (uploadRes.data?.msg || 'Unknown error'));
  }

  const fileId = uploadRes.data.result.id;
  const embedUrl = `https://streamtape.com/v/${fileId}/`; // Watch link (the bot accepts both v and e links)
  log(`Upload complete! Link: ${embedUrl}`);
  return embedUrl;
}

// Recursively find video files in a folder
function findVideoFiles(dir, filesList = []) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      findVideoFiles(fullPath, filesList);
    } else {
      const ext = path.extname(item).toLowerCase();
      if (['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
        filesList.push({ path: fullPath, name: item });
      }
    }
  }
  return filesList;
}

// Clean directory recursively
function deleteFolderRecursive(folderPath) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const curPath = path.join(folderPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(folderPath);
  }
}

async function processZips() {
  log('====================================================');
  log('Starting Batch Zip Extraction & Streamtape Upload');
  log('====================================================');
  
  const zipFiles = fs.readdirSync(ZIP_DIR).filter(file => file.endsWith('.zip'));
  
  if (zipFiles.length === 0) {
    log(`No .zip files found in: ${ZIP_DIR}`);
    log('Please place your .zip files in the "zips_to_upload" folder and run this script again.');
    return;
  }
  
  log(`Found ${zipFiles.length} zip file(s) to process.`);
  
  for (let i = 0; i < zipFiles.length; i++) {
    const zipName = zipFiles[i];
    const zipPath = path.join(ZIP_DIR, zipName);
    const currentTempDest = path.join(TEMP_DIR, `extract_${Date.now()}`);
    
    log(`----------------------------------------------------`);
    log(`[${i + 1}/${zipFiles.length}] Processing: ${zipName}`);
    
    try {
      // Create temp extraction directory
      if (!fs.existsSync(currentTempDest)) fs.mkdirSync(currentTempDest, { recursive: true });
      
      // Unzip using Windows PowerShell (avoiding npm zip modules for compatibility)
      log('Extracting zip file...');
      const powershellCmd = `powershell -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${currentTempDest.replace(/'/g, "''")}' -Force"`;
      execSync(powershellCmd, { stdio: 'inherit' });
      log('Extraction complete.');
      
      // Find video files inside
      const videos = findVideoFiles(currentTempDest);
      log(`Found ${videos.length} video file(s) inside.`);
      
      if (videos.length === 0) {
        log('⚠️ No video files found in zip. Skipping.');
        // Clean up temp extraction folder
        deleteFolderRecursive(currentTempDest);
        continue;
      }
      
      // Upload each video to Streamtape
      const uploadedLinks = [];
      for (const video of videos) {
        try {
          const embedUrl = await uploadToStreamtape(video.path, video.name);
          uploadedLinks.push({ name: video.name, url: embedUrl });
        } catch (uploadErr) {
          err(`Failed to upload ${video.name}: ${uploadErr.message}`);
        }
      }
      
      if (uploadedLinks.length > 0) {
        // Write results to output text file
        const zipTitle = path.basename(zipName, '.zip');
        let fileContent = `====================================================\n`;
        fileContent += `📦 ZIP: ${zipTitle}\n`;
        fileContent += `====================================================\n`;
        uploadedLinks.forEach((v, index) => {
          fileContent += `${zipTitle} - Part ${index + 1}\n`;
          fileContent += `${v.url}\n\n`;
        });
        fileContent += `\n`;
        
        fs.appendFileSync(OUTPUT_FILE, fileContent, 'utf8');
        log(`Links appended to: ${OUTPUT_FILE}`);
      }
      
      // Clean up temp folder
      deleteFolderRecursive(currentTempDest);
      
      // Move processed zip to processed_zips directory
      const processedPath = path.join(PROCESSED_DIR, zipName);
      if (fs.existsSync(processedPath)) {
        // If file already exists, append timestamp
        const ext = path.extname(zipName);
        const base = path.basename(zipName, ext);
        fs.renameSync(zipPath, path.join(PROCESSED_DIR, `${base}_${Date.now()}${ext}`));
      } else {
        fs.renameSync(zipPath, processedPath);
      }
      log(`Moved processed zip to: ${PROCESSED_DIR}`);
      
    } catch (e) {
      err(`Error processing zip file ${zipName}: ${e.message}`);
      // Try to clean up temp extraction folder just in case
      try { deleteFolderRecursive(currentTempDest); } catch (_) {}
    }
  }
  
  log('====================================================');
  log('🎉 All zip files processed successfully!');
  log(`All output links are saved in: ${OUTPUT_FILE}`);
  log('====================================================');
}

processZips().catch(e => err(`Fatal script error: ${e.message}`));
