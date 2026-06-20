/* ============================================
   VideoSLK Bot — Video Processor
   FFmpeg-based preview clip + thumbnail generator
   Optimized for 1GB RAM / 1 CPU core
   ============================================ */

const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { config } = require('../config');

// ===== Configuration =====
const PREVIEW = {
    durationMin: 5,       // seconds — randomized per clip
    durationMax: 8,
    maxWidth: 720,        // pixels
    videoBitrate: '800k',
    audioBitrate: '96k',
    fps: 24,
    format: 'mp4'
};

function pickPreviewDuration() {
    return PREVIEW.durationMin + Math.floor(Math.random() * (PREVIEW.durationMax - PREVIEW.durationMin + 1));
}

const THUMBNAIL = {
    width: 640,
    height: 360,
    format: 'webp',
    quality: 80
};

// ===== Get Video Duration =====
function getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                console.error('   ⚠️ ffprobe error:', err.message);
                resolve(30); // Default 30 seconds if probe fails
                return;
            }

            const duration = metadata.format.duration || 30;
            console.log(`   📏 Video duration: ${duration.toFixed(1)}s`);
            resolve(Math.floor(duration));
        });
    });
}

// ===== Get Random Start Time =====
function getRandomStartTime(totalDuration, clipDuration) {
    // Ensure we don't go past the end
    const maxStart = Math.max(0, totalDuration - clipDuration - 1);

    if (maxStart <= 0) {
        return 0;
    }

    // Prefer middle section (avoid intros and outros)
    // Pick from 10% to 80% of the video
    const rangeStart = Math.floor(totalDuration * 0.1);
    const rangeEnd = Math.floor(totalDuration * 0.8);
    const effectiveStart = Math.min(rangeStart, maxStart);
    const effectiveEnd = Math.min(rangeEnd, maxStart);

    if (effectiveEnd <= effectiveStart) {
        return effectiveStart;
    }

    const randomTime = effectiveStart + Math.floor(Math.random() * (effectiveEnd - effectiveStart));
    return randomTime;
}

// ===== Format Seconds to MM:SS =====
function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ===== Format Seconds to ISO 8601 Duration =====
function formatDurationISO(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    if (mins > 0 && secs > 0) {
        return `${mins}M${secs}S`;
    } else if (mins > 0) {
        return `${mins}M`;
    } else {
        return `${secs}S`;
    }
}

// ===== Generate Preview Clip =====
function generatePreview(videoPath, outputPath, startTime, duration) {
    const clipDuration = duration || pickPreviewDuration();
    return new Promise((resolve, reject) => {
        console.log(`   🎬 Generating preview: ${startTime}s → ${startTime + clipDuration}s (${clipDuration}s)`);

        ffmpeg(videoPath)
            .setStartTime(startTime)
            .setDuration(clipDuration)
            .videoFilters([
                // Scale to max width while maintaining aspect ratio
                `scale='min(${PREVIEW.maxWidth},iw)':-2`,
                // Add slight brightness to make preview pop
                'eq=brightness=0.03:saturation=1.1'
            ])
            .videoCodec('libx264')
            .videoBitrate(PREVIEW.videoBitrate)
            .fps(PREVIEW.fps)
            .audioCodec('aac')
            .audioBitrate(PREVIEW.audioBitrate)
            .audioChannels(1) // Mono to save space
            .outputOptions([
                '-preset ultrafast',     // Fast encoding for low CPU
                '-tune fastdecode',      // Optimize for fast decoding
                '-movflags +faststart',  // Web streaming optimization
                '-pix_fmt yuv420p',      // Maximum compatibility
                '-threads 1',            // Single thread for 1 CPU core
                '-max_muxing_queue_size 1024'
            ])
            .format(PREVIEW.format)
            .on('start', (cmd) => {
                console.log(`   🔧 FFmpeg preview command started`);
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    process.stdout.write(`\r   ⏳ Preview: ${Math.round(progress.percent)}%`);
                }
            })
            .on('end', () => {
                console.log(`\n   ✅ Preview generated: ${outputPath}`);

                // Check file size
                const stats = fs.statSync(outputPath);
                console.log(`   📦 Preview size: ${(stats.size / 1024).toFixed(1)} KB`);

                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error(`\n   ❌ Preview generation failed:`, err.message);
                reject(new Error('Preview generation failed: ' + err.message));
            })
            .save(outputPath);
    });
}

// ===== Generate Thumbnail =====
function generateThumbnail(videoPath, outputPath, timestamp) {
    return new Promise((resolve, reject) => {
        console.log(`   📸 Generating thumbnail at ${timestamp}s`);

        ffmpeg(videoPath)
            .seekInput(timestamp)
            .frames(1)
            .videoFilters([
                `scale=${THUMBNAIL.width}:${THUMBNAIL.height}:force_original_aspect_ratio=increase`,
                `crop=${THUMBNAIL.width}:${THUMBNAIL.height}`,
                // Slight contrast boost for eye-catching thumbnails
                'eq=brightness=0.05:contrast=1.1:saturation=1.2'
            ])
            .outputOptions([
                '-threads 1',
                '-q:v 80'   // Quality for webp
            ])
            .format('image2')
            .on('start', () => {
                console.log(`   🔧 FFmpeg thumbnail command started`);
            })
            .on('end', () => {
                // If output is not webp, we need to handle differently
                // fluent-ffmpeg might output as png/jpg depending on extension
                console.log(`   ✅ Thumbnail generated: ${outputPath}`);

                const stats = fs.statSync(outputPath);
                console.log(`   📦 Thumbnail size: ${(stats.size / 1024).toFixed(1)} KB`);

                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error(`   ❌ Thumbnail generation failed:`, err.message);
                // Try fallback without filters
                generateThumbnailFallback(videoPath, outputPath, timestamp)
                    .then(resolve)
                    .catch(reject);
            })
            .save(outputPath);
    });
}

// ===== Thumbnail Fallback (simpler command) =====
function generateThumbnailFallback(videoPath, outputPath, timestamp) {
    return new Promise((resolve, reject) => {
        console.log(`   🔄 Trying thumbnail fallback method...`);

        // Change output to jpg if webp fails
        const jpgPath = outputPath.replace('.webp', '.jpg');

        ffmpeg(videoPath)
            .seekInput(timestamp)
            .frames(1)
            .size(`${THUMBNAIL.width}x?`)
            .outputOptions(['-threads 1'])
            .on('end', () => {
                console.log(`   ✅ Fallback thumbnail generated: ${jpgPath}`);

                // Try to rename to webp (it's actually jpg but that's ok)
                if (jpgPath !== outputPath) {
                    try {
                        if (fs.existsSync(jpgPath)) {
                            fs.renameSync(jpgPath, outputPath);
                        }
                    } catch (e) {
                        // Use jpg path instead
                        resolve(jpgPath);
                        return;
                    }
                }

                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error(`   ❌ Fallback thumbnail also failed:`, err.message);
                // Create a blank placeholder
                createPlaceholderThumbnail(outputPath)
                    .then(resolve)
                    .catch(reject);
            })
            .save(jpgPath);
    });
}

// ===== Create Placeholder Thumbnail =====
function createPlaceholderThumbnail(outputPath) {
    return new Promise((resolve, reject) => {
        console.log(`   🎨 Creating placeholder thumbnail...`);

        // Use ffmpeg to generate a colored frame
        const jpgPath = outputPath.replace('.webp', '.jpg');

        ffmpeg()
            .input('color=c=0x1A1A1A:s=640x360:d=1')
            .inputFormat('lavfi')
            .frames(1)
            .outputOptions(['-threads 1'])
            .on('end', () => {
                console.log(`   ✅ Placeholder thumbnail created`);

                if (jpgPath !== outputPath && fs.existsSync(jpgPath)) {
                    try {
                        fs.renameSync(jpgPath, outputPath);
                    } catch (e) {
                        resolve(jpgPath);
                        return;
                    }
                }

                resolve(outputPath);
            })
            .on('error', (err) => {
                // Last resort: create a tiny 1x1 pixel file
                console.log(`   ⚠️ Using empty placeholder`);
                fs.writeFileSync(outputPath, Buffer.alloc(100));
                resolve(outputPath);
            })
            .save(jpgPath);
    });
}

// ===== Preview Generation with Retry =====
async function generatePreviewWithRetry(videoPath, outputPath, startTime, duration, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await generatePreview(videoPath, outputPath, startTime, duration);
        } catch (err) {
            console.log(`   🔄 Preview attempt ${attempt}/${retries} failed`);

            if (attempt === retries) {
                // Last attempt: try from the beginning
                console.log(`   🔄 Final attempt: preview from 0s`);
                return await generatePreview(videoPath, outputPath, 0, duration);
            }

            // Adjust start time for next attempt
            startTime = Math.max(0, startTime - 5);
        }
    }
}

// ===== Main Process Function =====
async function processVideo(videoPath, slug) {
    console.log(`\n🎬 Processing video: ${slug}`);
    console.log(`   📂 Source: ${videoPath}`);

    // Ensure temp directory
    const tempDir = path.resolve(config.tempDir);
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // Output paths
    const previewPath = path.join(tempDir, `${slug}_preview.mp4`);
    const thumbnailPath = path.join(tempDir, `${slug}_thumb.webp`);

    // Step 1: Get video duration
    const totalDuration = await getVideoDuration(videoPath);

    // Step 2: Pick clip length 5-8s and calculate random start time
    const clipDuration = pickPreviewDuration();
    const previewStart = getRandomStartTime(totalDuration, clipDuration);
    console.log(`   🎯 Preview: ${previewStart}s for ${clipDuration}s`);

    // Step 3: Calculate thumbnail timestamp (slightly before preview)
    const thumbTime = Math.max(0, previewStart + Math.floor(clipDuration / 2));
    console.log(`   🎯 Thumbnail time: ${thumbTime}s`);

    // Step 4: Generate preview clip
    await generatePreviewWithRetry(videoPath, previewPath, previewStart, clipDuration);

    // Step 5: Generate thumbnail
    await generateThumbnail(videoPath, thumbnailPath, thumbTime);

    // Step 6: Verify output files exist
    if (!fs.existsSync(previewPath)) {
        throw new Error('Preview file was not created');
    }

    // Use fallback path for thumbnail if webp wasn't created
    let finalThumbPath = thumbnailPath;
    if (!fs.existsSync(thumbnailPath)) {
        const jpgFallback = thumbnailPath.replace('.webp', '.jpg');
        if (fs.existsSync(jpgFallback)) {
            finalThumbPath = jpgFallback;
        } else {
            throw new Error('Thumbnail file was not created');
        }
    }

    const result = {
        previewPath: previewPath,
        thumbnailPath: finalThumbPath,
        duration: formatDuration(totalDuration),
        durationISO: formatDurationISO(totalDuration),
        durationSeconds: totalDuration,
        previewStart: previewStart,
        previewDuration: clipDuration
    };

    console.log(`   ✅ Processing complete!`);
    console.log(`   📹 Preview: ${previewPath}`);
    console.log(`   📸 Thumbnail: ${finalThumbPath}`);
    console.log(`   ⏱ Duration: ${result.duration}`);

    return result;
}

// ===== Check FFmpeg Installation =====
function checkFFmpeg() {
    return new Promise((resolve) => {
        ffmpeg.getAvailableFormats((err, formats) => {
            if (err) {
                console.error('❌ FFmpeg not found!');
                console.error('   Install FFmpeg:');
                console.error('   Ubuntu: sudo apt install ffmpeg');
                console.error('   Mac: brew install ffmpeg');
                resolve(false);
            } else {
                console.log('✅ FFmpeg is available');
                resolve(true);
            }
        });
    });
}

module.exports = {
    processVideo,
    getVideoDuration,
    formatDuration,
    formatDurationISO,
    checkFFmpeg
};