/* ============================================
   VideoSLK Bot — FFmpeg Installer Helper
   Checks FFmpeg availability and provides
   installation instructions
   ============================================ */

const { exec } = require('child_process');
const os = require('os');

function checkFFmpegInstalled() {
    return new Promise((resolve) => {
        exec('ffmpeg -version', (err, stdout) => {
            if (err) {
                resolve({ installed: false, version: null });
            } else {
                const versionMatch = stdout.match(/ffmpeg version (\S+)/);
                const version = versionMatch ? versionMatch[1] : 'unknown';
                resolve({ installed: true, version: version });
            }
        });
    });
}

function checkFFprobeInstalled() {
    return new Promise((resolve) => {
        exec('ffprobe -version', (err, stdout) => {
            if (err) {
                resolve({ installed: false, version: null });
            } else {
                const versionMatch = stdout.match(/ffprobe version (\S+)/);
                const version = versionMatch ? versionMatch[1] : 'unknown';
                resolve({ installed: true, version: version });
            }
        });
    });
}

async function verifyFFmpeg() {
    console.log('🔍 Checking FFmpeg installation...\n');

    const ffmpeg = await checkFFmpegInstalled();
    const ffprobe = await checkFFprobeInstalled();

    if (ffmpeg.installed && ffprobe.installed) {
        console.log(`✅ FFmpeg  : v${ffmpeg.version}`);
        console.log(`✅ FFprobe : v${ffprobe.version}`);
        console.log(`✅ Platform: ${os.platform()} ${os.arch()}`);
        console.log(`✅ Memory  : ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`);
        console.log(`✅ CPUs    : ${os.cpus().length}`);
        console.log('\n✅ FFmpeg is ready!\n');
        return true;
    }

    console.log('❌ FFmpeg is NOT installed!\n');
    console.log('📋 Installation Instructions:\n');

    const platform = os.platform();

    if (platform === 'linux') {
        console.log('Ubuntu / Debian:');
        console.log('  sudo apt update');
        console.log('  sudo apt install -y ffmpeg\n');

        console.log('CentOS / RHEL:');
        console.log('  sudo yum install -y epel-release');
        console.log('  sudo yum install -y ffmpeg\n');

        console.log('Alpine:');
        console.log('  apk add ffmpeg\n');
    } else if (platform === 'darwin') {
        console.log('macOS (Homebrew):');
        console.log('  brew install ffmpeg\n');
    } else if (platform === 'win32') {
        console.log('Windows:');
        console.log('  1. Download from https://ffmpeg.org/download.html');
        console.log('  2. Extract to C:\\ffmpeg');
        console.log('  3. Add C:\\ffmpeg\\bin to System PATH\n');
    }

    console.log('After installing, run this check again:');
    console.log('  node modules/ffmpegInstaller.js\n');

    return false;
}

// Run check if called directly
if (require.main === module) {
    verifyFFmpeg().then(result => {
        process.exit(result ? 0 : 1);
    });
}

module.exports = { verifyFFmpeg, checkFFmpegInstalled };