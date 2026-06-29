/* ============================================
   Videos.LK Bot — GitHub Uploader
   Uploads: Thumbnail image + HTML + metadata
   No video files — super fast!
   ============================================ */

const https = require('https');
const { config } = require('../config');

const GITHUB_API = 'api.github.com';
const REPO = config.githubRepo;
const BRANCH = config.githubBranch;
const TOKEN = config.githubToken;

// ===== GitHub API Request =====
function githubRequest(method, endpoint, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const options = {
      hostname: GITHUB_API, path: endpoint, method: method,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'User-Agent': 'Videos.LK-Bot/1.0',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);

    const req = https.request(options, (res) => {
      let rd = '';
      res.on('data', c => rd += c);
      res.on('end', () => {
        try {
          const p = rd ? JSON.parse(rd) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(p);
          else if (res.statusCode === 409) resolve({ conflict: true });
          else reject(new Error(`GitHub ${res.statusCode}: ${p.message || 'error'}`));
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({});
          else reject(new Error(`GitHub ${res.statusCode}`));
        }
      });
    });
    req.on('error', e => reject(e));
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ===== SHA Cache (avoids re-fetching file SHAs on rapid sequential updates) =====
const shaCache = {};

// ===== Resilient Request Wrapper =====
async function resilientRequest(method, endpoint, data, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await githubRequest(method, endpoint, data);
    } catch (err) {
      const isRateLimit = err.message.includes('403') || err.message.includes('rate limit');
      if (i === retries - 1) throw err;
      
      const delay = isRateLimit ? 60000 : Math.pow(2, i) * 1000;
      console.log(`   ⏳ Retry ${i + 1}/${retries} in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function getFileSHA(filePath) {
  if (shaCache[filePath]) return shaCache[filePath];
  try {
    const r = await resilientRequest('GET', `/repos/${REPO}/contents/${filePath}?ref=${BRANCH}`);
    if (r && r.sha) {
      shaCache[filePath] = r.sha;
      return r.sha;
    }
    return null;
  } catch (e) { return null; }
}

async function uploadFile(repoPath, content, commitMsg, isBase64) {
  console.log(`   📤 ${repoPath}`);
  const sha = await getFileSHA(repoPath);
  const data = {
    message: commitMsg,
    content: isBase64 ? content : Buffer.from(content, 'utf8').toString('base64'),
    branch: BRANCH
  };
  if (sha) data.sha = sha;

  const r = await resilientRequest('PUT', `/repos/${REPO}/contents/${repoPath}`, data);
  if (r && r.sha) shaCache[repoPath] = r.sha;
  
  if (r && r.conflict) {
    const freshSHA = await githubRequest('GET', `/repos/${REPO}/contents/${repoPath}?ref=${BRANCH}`).then(res => res.sha).catch(() => null);
    if (freshSHA) {
      data.sha = freshSHA;
      shaCache[repoPath] = freshSHA;
      await resilientRequest('PUT', `/repos/${REPO}/contents/${repoPath}`, data);
    }
  }
  console.log(`   ✅ ${repoPath}`);
}

// ===== Fetch Existing videos.js =====
async function fetchExistingVideos() {
  try {
    const r = await githubRequest('GET', `/repos/${REPO}/contents/js/videos.js?ref=${BRANCH}`);
    if (r && r.content) {
      const content = Buffer.from(r.content, 'base64').toString('utf8');
      const match = content.match(/const VIDEOS_DATA = ({[\s\S]*?});/);
      if (match) return JSON.parse(match[1].replace(/'/g, '"').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
    }
    return {};
  } catch (e) { return {}; }
}

function detectCategory(caption) {
  const l = (caption || '').toLowerCase();
  const m = {
    'funny': ['funny', 'comedy', 'හිනා', '😂'],
    'sports': ['cricket', 'football', 'sport', '🏏'],
    'entertainment': ['celebrity', 'tiktok', 'dance', '🎬'],
    'shocking': ['shocking', 'accident', 'camera', '😱']
  };
  for (const [c, kws] of Object.entries(m)) {
    for (const k of kws) { if (l.includes(k)) return c; }
  }
  return 'entertainment';
}

function generateTags(caption, category) {
  const tags = new Set([category, 'viral', 'trending']);
  const l = (caption || '').toLowerCase();
  const m = { 'funny': ['funny'], 'cricket': ['cricket', 'sports'], 'tiktok': ['tiktok'], 'dance': ['dance'], 'celebrity': ['celebrity'], 'leaked': ['leaked', 'exclusive'] };
  Object.keys(m).forEach(k => { if (l.includes(k)) m[k].forEach(t => tags.add(t)); });
  return Array.from(tags).slice(0, 8);
}

function randomViews() {
  const ranges = [{ min: 5000, max: 15000, w: 40 }, { min: 15000, max: 40000, w: 30 }, { min: 40000, max: 80000, w: 20 }, { min: 80000, max: 150000, w: 10 }];
  let r = Math.random() * 100, c = 0;
  for (const range of ranges) { c += range.w; if (r <= c) return Math.floor(Math.random() * (range.max - range.min) + range.min); }
  return 15000;
}

function fmtViews(n) { if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return n.toString(); }
function escXml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function generateVideosJS(all) {
  let js = `/* Videos.LK — Updated: ${new Date().toISOString()} */\nconst VIDEOS_DATA = ${JSON.stringify(all, null, 2)};\n`;
  js += `function getAllVideos(){return Object.values(VIDEOS_DATA)}\n`;
  js += `function getVideoById(id){return VIDEOS_DATA[id]||null}\n`;
  js += `function getVideosByCategory(c){return getAllVideos().filter(function(v){return v.category===c})}\n`;
  js += `function getTrendingVideos(l){l=l||8;return getAllVideos().sort(function(a,b){return b.views-a.views}).slice(0,l)}\n`;
  js += `function getLatestVideos(l){l=l||8;return getAllVideos().sort(function(a,b){return new Date(b.date)-new Date(a.date)}).slice(0,l)}\n`;
  js += `function getRelatedVideos(id,l){l=l||6;var v=getVideoById(id);if(!v)return getAllVideos().slice(0,l);return getAllVideos().filter(function(x){return x.id!==id}).filter(function(x){return x.tags.some(function(t){return v.tags.indexOf(t)!==-1})}).sort(function(a,b){return b.views-a.views}).slice(0,l)}\n`;
  js += `function formatViews(n){if(n>=1000000)return(n/1000000).toFixed(1)+'M';if(n>=1000)return(n/1000).toFixed(1)+'K';return n.toString()}\n`;
  js += `function getCategories(){var c=new Set();getAllVideos().forEach(function(v){c.add(v.category)});return Array.from(c)}\n`;
  return js;
}

// ===== Generate Watch Page with Thumbnail =====
// ===== Generate Watch Page =====
function generateWatchPage(slug, video) {
  const siteUrl = config.siteUrl || 'https://videoslk.eu.cc';
  const pageUrl = `${siteUrl}/watch/${slug}.html`;
  const encodedUrl = encodeURIComponent(pageUrl);
  const thumbUrl = video.thumbnail ? `${siteUrl}/${video.thumbnail}` : '';
  const tagsHtml = (video.tags || []).map(t => `<span class="video-tag">#${escHtml(t)}</span>`).join('\n            ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">

  <!-- SEO Meta — Bot replaces these -->
  <title>${escHtml(video.title)} | VideoSLK</title>
  <meta name="description" content="${escHtml(video.description)} Watch the preview and unlock the full video for free on VideoSLK.">
  <meta name="keywords" content="${(video.tags || []).join(', ')}, viral video, trending, exclusive, unlock video">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="https://videoslk.eu.cc/watch/${slug}.html">

  <!-- Open Graph -->
  <meta property="og:type" content="video.other">
  <meta property="og:title" content="${escHtml(video.title)} | VideoSLK">
  <meta property="og:description" content="${escHtml(video.description)}">
  <meta property="og:url" content="https://videoslk.eu.cc/watch/${slug}.html">
  <meta property="og:image" content="https://videoslk.eu.cc/${video.thumbnail || ''}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:video" content="https://videoslk.eu.cc/${video.preview || ''}">
  <meta property="og:video:secure_url" content="https://videoslk.eu.cc/${video.preview || ''}">
  <meta property="og:video:type" content="video/mp4">
  <meta property="og:video:width" content="720">
  <meta property="og:video:height" content="406">
  <meta property="og:site_name" content="VideoSLK">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="player">
  <meta name="twitter:title" content="${escHtml(video.title)} | VideoSLK">
  <meta name="twitter:description" content="${escHtml(video.description)}">
  <meta name="twitter:image" content="https://videoslk.eu.cc/${video.thumbnail || ''}">
  <meta name="twitter:player" content="https://videoslk.eu.cc/${video.preview || ''}">

  <!-- Schema.org VideoObject -->
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"VideoObject","name":"${escHtml(video.title)}","description":"${escHtml(video.description)}","thumbnailUrl":"https://videoslk.eu.cc/${video.thumbnail || ''}","contentUrl":"https://videoslk.eu.cc/${video.preview || ''}","uploadDate":"${video.date}","duration":"PT${video.durationISO || '0S'}","interactionStatistic":{"@type":"InteractionCounter","interactionType":{"@type":"WatchAction"},"userInteractionCount":${video.views || 0}},"publisher":{"@type":"Organization","name":"VideoSLK","url":"https://videoslk.eu.cc"}}
  </script>

  <meta name="theme-color" content="#CC0000">
  <link rel="manifest" href="/manifest.json">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/icon-32.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="image" href="https://videoslk.eu.cc/${video.thumbnail || ''}" fetchpriority="high">
  <link rel="dns-prefetch" href="https://quge5.com">
  <link rel="dns-prefetch" href="https://omg10.com">
  <link rel="preconnect" href="https://t.me">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link rel="stylesheet" href="/css/style.css?v=13">
  <!-- Adblock detector -->
  <script src="/js/adblock.js?v=10"></script>
  <script src="https://quge5.com/88/tag.min.js" data-zone="218420" async data-cfasync="false"></script>
  <style>
    .preview-thumb-wrapper{position:relative;width:100%;aspect-ratio:16/9;border-radius:var(--radius-lg);overflow:hidden;background:#111;border:1px solid var(--border-subtle);box-shadow:var(--shadow-card)}
    .preview-thumb-img,.preview-video{width:100%;height:100%;object-fit:cover;filter:brightness(0.7) blur(1px);transition:filter 0.3s;display:block}
    .preview-thumb-wrapper:hover .preview-thumb-img,.preview-thumb-wrapper:hover .preview-video{filter:brightness(0.55) blur(2px)}
    .preview-overlay{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;z-index:2;pointer-events:none}
    .preview-overlay > *{pointer-events:auto}
    .preview-lock{font-size:3.5rem;margin-bottom:10px;animation:lockBounce 2s ease infinite;filter:drop-shadow(0 0 20px rgba(204,0,0,0.5))}
    .preview-lock-text{font-size:1.1rem;font-weight:800;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,0.8)}
    .preview-lock-sub{font-size:0.85rem;color:rgba(255,255,255,0.92);margin-top:4px;text-shadow:0 2px 6px rgba(0,0,0,0.8)}
    .preview-duration-badge{margin-top:12px;padding:6px 18px;background:rgba(204,0,0,0.22);border:1px solid rgba(204,0,0,0.45);border-radius:50px;font-size:0.8rem;color:#fff;font-weight:700;backdrop-filter:blur(5px)}
    .preview-cta-btn:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(204,0,0,0.5)}
    .preview-gradient{position:absolute;bottom:0;left:0;width:100%;height:50%;background:linear-gradient(transparent,rgba(0,0,0,0.8));z-index:1;pointer-events:none}
    .no-thumb-bg{position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);z-index:0}
    .no-thumb-bg::after{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:120px;height:120px;border:3px solid rgba(204,0,0,0.2);border-radius:50%;animation:pulse-ring 2s ease infinite}
    @keyframes pulse-ring{0%{transform:translate(-50%,-50%) scale(0.8);opacity:1}100%{transform:translate(-50%,-50%) scale(1.5);opacity:0}}

    .vslk-sticky-unlock{display:none}
    @media (max-width:720px){
      .vslk-sticky-unlock{display:flex;position:fixed;left:12px;right:12px;bottom:12px;z-index:90;background:linear-gradient(135deg,#CC0000,#FF6B00);color:#fff;border:0;padding:14px 18px;border-radius:50px;font-weight:800;font-size:0.98rem;justify-content:center;align-items:center;gap:6px;box-shadow:0 14px 36px rgba(204,0,0,0.45);cursor:pointer;animation:cta-pulse 2.6s ease infinite}
      .vslk-sticky-unlock.hide{display:none !important}
      @keyframes cta-pulse{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
      main{padding-bottom:80px}
    }
  </style>
</head>
<body data-video-id="${slug}">
  <div class="loading-screen">
    <div class="loading-logo">VIDEO<span>SLK</span></div>
    <div class="loading-bar-container"><div class="loading-bar"></div></div>
  </div>
  <canvas id="particles-canvas"></canvas>
  <canvas id="confetti-canvas"></canvas>
  <header class="header">
    <div class="header-inner">
      <a href="/" class="logo"><div class="logo-icon"><i class="fa-solid fa-play"></i></div><div class="logo-text">VIDEO<span>SLK</span></div></a>
      <nav class="nav-links">
        <a href="/" class="nav-link"><i class="fa-solid fa-house"></i> Home</a>
        <a href="/trending.html" class="nav-link"><i class="fa-solid fa-fire"></i> Trending</a>
        <a href="/latest.html" class="nav-link"><i class="fa-solid fa-clock"></i> Latest</a>
        <a href="/viral.html" class="nav-link"><i class="fa-solid fa-bolt"></i> Viral</a>
        <a href="https://t.me/ukussa69new" target="_blank" rel="noopener" class="nav-link nav-telegram"><i class="fa-brands fa-telegram"></i> Telegram</a>
      </nav>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="search-toggle-btn" aria-label="Search"><i class="fa-solid fa-magnifying-glass"></i></button>
        <button class="mobile-menu-btn" aria-label="Menu"><span></span><span></span><span></span></button>
      </div>
    </div>
  </header>
  <div class="search-overlay">
    <div class="search-header"><span class="search-icon"><i class="fa-solid fa-magnifying-glass"></i></span><input type="search" id="search-input" class="search-input" placeholder="Search videos..." autocomplete="off"><button class="search-close-btn">✕</button></div>
    <div class="search-results-container" id="search-results"></div>
  </div>
  <main class="main">
    <div class="container watch-page">
      <div class="breadcrumb-container" id="breadcrumbs"></div>
      <div class="watch-layout" data-video-id="${slug}">

        <!-- AUTOPLAY PREVIEW (muted loop) + title + UNLOCK above the fold -->
        <div class="preview-thumb-wrapper animate-on-scroll" id="preview-wrapper">
          <span class="preview-badge"><i class="fa-solid fa-bolt"></i> PREVIEW</span>
          <video class="preview-video" src="/${video.preview || ''}" autoplay muted loop playsinline poster="/${video.thumbnail || ''}" preload="auto"></video>
          <div class="preview-gradient"></div>
          <div class="preview-overlay">
            <div class="preview-lock"><i class="fa-solid fa-lock"></i></div>
            <div class="preview-lock-text">Full Video Locked</div>
            <div class="preview-lock-sub">සම්පූර්ණ Video එක Lock කරලා — පහත steps complete කරන්න</div>
            <div class="preview-duration-badge"><i class="fa-solid fa-clock"></i> ${video.duration || '0:00'} · ${fmtViews(video.views || 0)} views</div>
            <button type="button" class="preview-cta-btn" onclick="document.getElementById('unlock-section').scrollIntoView({behavior:'smooth',block:'start'})" style="margin-top:14px;background:linear-gradient(135deg,#CC0000,#FF6B00);color:#fff;border:0;padding:11px 24px;border-radius:50px;font-weight:800;font-size:0.95rem;cursor:pointer;box-shadow:0 8px 24px rgba(204,0,0,0.4);"><i class="fa-solid fa-lock-open"></i> Unlock Now — දැන්ම Unlock කරන්න <i class="fa-solid fa-arrow-down"></i></button>
          </div>
        </div>

        <!-- Dynamic Gallery Grid for Multiple Parts -->
        <div id="batch-gallery-container" style="display: none; margin: 20px 0; padding: 18px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-card);">
          <h3 style="margin: 0 0 14px; font-weight: 800; font-size: 1.1rem; color: #fff; display: flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-layer-group" style="color: var(--red-primary);"></i> Video Parts Gallery (<span id="batch-parts-count">0</span> Parts)
          </h3>
          <div id="batch-gallery-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px;">
             <!-- Rendered dynamically -->
          </div>
        </div>

        <script>
          (function() {
            const rawThumbs = "${video.thumbnailsAll || video.thumbnail || ''}";
            const rawUrls = "${video.embedUrl || ''}";
            
            // Parse comma-separated strings
            const thumbs = rawThumbs.split(',').map(t => t.trim()).filter(Boolean);
            const urls = rawUrls.split(',').map(u => u.trim()).filter(Boolean);
            
            if (urls.length > 1) {
              const galleryContainer = document.getElementById('batch-gallery-container');
              const galleryGrid = document.getElementById('batch-gallery-grid');
              const partsCountSpan = document.getElementById('batch-parts-count');
              
              if (galleryContainer && galleryGrid) {
                galleryContainer.style.display = 'block';
                if (partsCountSpan) partsCountSpan.textContent = urls.length;
                galleryGrid.innerHTML = '';
                
                urls.forEach((url, index) => {
                  const partNum = index + 1;
                  const thumb = thumbs[index] || thumbs[0] || 'assets/thumbs/default-video.jpg';
                  
                  // Create card element
                  const card = document.createElement('div');
                  card.className = 'gallery-part-card';
                  card.style.cssText = 'position:relative; aspect-ratio:16/9; border-radius:var(--radius-md); overflow:hidden; border:1px solid var(--border-subtle); background:#111; cursor:pointer; transition:transform 0.2s, border-color 0.2s; box-shadow: 0 4px 10px rgba(0,0,0,0.3);';
                  
                  // Convert Streamtape embed to watch URL on the fly
                  const watchUrl = url.replace('/e/', '/v/');
                  
                  card.innerHTML = 
                    "<img src=\"/" + thumb + "\" style=\"width:100%; height:100%; object-fit:cover; display:block; filter:brightness(0.55); transition: filter 0.2s;\">" +
                    "<div style=\"position:absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; color:#fff; text-shadow:0 2px 6px rgba(0,0,0,0.9); font-weight:800; font-size:0.88rem; gap: 4px;\">" +
                    "  <span class=\"part-lock-icon\" style=\"font-size:1.1rem; color: #ff5555;\"><i class=\"fa-solid fa-lock\"></i></span>" +
                    "  <span>Part " + partNum + "</span>" +
                    "</div>";
                  
                  // Card hover effects
                  card.onmouseenter = () => { 
                    card.style.transform = 'scale(1.04)'; 
                    card.style.borderColor = 'var(--red-primary)';
                    const img = card.querySelector('img');
                    if (img) img.style.filter = 'brightness(0.45)';
                  };
                  card.onmouseleave = () => { 
                    card.style.transform = 'scale(1)'; 
                    card.style.borderColor = 'var(--border-subtle)';
                    const img = card.querySelector('img');
                    if (img) img.style.filter = 'brightness(0.55)';
                  };
                  
                  // On click handler
                  card.onclick = function() {
                    const videoId = document.body.getAttribute('data-video-id') || window.location.pathname.split('/').pop().replace('.html', '');
                    const isUnlocked = sessionStorage.getItem('vslk_unlocked_' + videoId) === '1' || sessionStorage.getItem('vslk_u_' + videoId) === '1';
                    if (isUnlocked) {
                      location.href = watchUrl;
                    } else {
                      document.getElementById('unlock-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
                      // highlight the unlock section
                      const unlockCard = document.getElementById('unlock-section');
                      if (unlockCard) {
                        unlockCard.style.outline = '3px solid var(--red-primary)';
                        setTimeout(() => { unlockCard.style.outline = 'none'; }, 2500);
                      }
                    }
                  };
                  
                  galleryGrid.appendChild(card);
                });
                
                // Watch for unlock event to update the lock icons
                const updateLockIcons = () => {
                  const videoId = document.body.getAttribute('data-video-id') || window.location.pathname.split('/').pop().replace('.html', '');
                  const isUnlocked = sessionStorage.getItem('vslk_unlocked_' + videoId) === '1' || sessionStorage.getItem('vslk_u_' + videoId) === '1';
                  if (isUnlocked) {
                    document.querySelectorAll('.part-lock-icon').forEach(icon => {
                      icon.innerHTML = '<i class="fa-solid fa-play" style="color: #00ffcc;"></i>';
                    });
                  }
                };
                
                // Run on load and periodically / after action
                updateLockIcons();
                document.addEventListener('click', () => setTimeout(updateLockIcons, 500));
              }
            }
          })();
        </script>

        <h1 class="video-title" style="margin:16px 0 6px;font-size:1.5rem;font-weight:900;line-height:1.25;">${escHtml(video.title)}</h1>
        <div class="video-meta" style="display:flex;gap:14px;flex-wrap:wrap;color:var(--text-muted);font-size:0.85rem;margin-bottom:10px;font-family:'JetBrains Mono',monospace;">
          <span><i class="fa-solid fa-eye"></i> ${fmtViews(video.views || 0)} views</span>
          <span><i class="fa-solid fa-calendar"></i> ${video.date}</span>
          <span><i class="fa-solid fa-clock"></i> ${video.duration || '0:00'}</span>
        </div>

        <!-- ===== UNLOCK SECTION ===== -->
        <div class="verification-card animate-on-scroll required" id="unlock-section">
          <div class="verification-progress-bar">
            <div class="verification-progress-fill" id="verification-progress-fill"></div>
          </div>
          <div class="verification-file-info">
            <div class="file-icon" id="file-info-icon"><i class="fa-solid fa-video"></i></div>
            <div class="file-details">
              <div class="file-name" id="file-info-name">${escHtml(video.title)}</div>
              <div class="file-meta" id="file-info-meta" style="font-family:'JetBrains Mono',monospace;">${fmtViews(video.views || 0)} views · ${video.duration || '0:00'}</div>
            </div>
          </div>
          <div class="verification-status-box" id="verification-status-box">
            <div class="status-title" id="status-title">Initializing Unlock</div>
            <div class="status-desc" id="status-desc">
              Complete both verification layers to access your content.
            </div>
          </div>
          <div class="verification-actions" id="verification-actions">
            <button type="button" class="btn-start-verify" disabled>Loading secure unlock...</button>
          </div>
        </div>
        <!-- ===== END UNLOCK SECTION ===== -->

        <div class="video-tags" style="margin:14px 0;">
          ${tagsHtml}
        </div>
        <div class="share-section" style="display:flex;align-items:center;gap:10px;margin:14px 0;">
          <span class="share-label">Share · බෙදන්න:</span>
          <a href="https://wa.me/?text=${encodedUrl}" target="_blank" rel="noopener" class="share-btn" title="WhatsApp"><i class="fa-brands fa-whatsapp"></i></a>
          <a href="https://t.me/share/url?url=${encodedUrl}" target="_blank" rel="noopener" class="share-btn" title="Telegram"><i class="fa-brands fa-telegram"></i></a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}" target="_blank" rel="noopener" class="share-btn" title="Facebook"><i class="fa-brands fa-facebook"></i></a>
          <button class="share-btn" title="Copy link" onclick="navigator.clipboard.writeText(window.location.href);this.innerHTML='<i class=\'fa-solid fa-check\'></i>';setTimeout(()=>this.innerHTML='<i class=\'fa-solid fa-link\'></i>',2000)"><i class="fa-solid fa-link"></i></button>
        </div>

        <div class="video-description animate-on-scroll" style="margin-top:12px;">
          <p>${escHtml(video.description)}</p>
        </div>

        <div class="premium-cta animate-on-scroll" style="background:linear-gradient(135deg,#CC0000 0%,#FF6B00 100%);border-radius:var(--radius-lg);padding:20px;margin:18px 0;text-align:center;color:#fff;">
          <h2 style="margin:0 0 4px;font-size:1.3rem;font-weight:900;"><i class="fa-solid fa-crown" style="color:#FFD700;"></i> Skip the Ads — Go Premium</h2>
          <p style="margin:0 0 4px;opacity:0.95;font-size:0.92rem;font-weight:600;"><i class="fa-solid fa-crown"></i> Ads නැතුවම බලන්න — Premium වෙන්න</p>
          <p style="margin:0 0 12px;opacity:0.95;font-size:0.88rem;">Full HD · Uncut · NEW videos daily · දිනපතා නව videos · One-time Telegram Stars payment</p>
          <a href="https://t.me/ukussa_69_bot?start=premium" target="_blank" rel="noopener" class="btn" style="background:#fff;color:#CC0000;font-weight:800;padding:10px 22px;border-radius:50px;text-decoration:none;display:inline-block;"><i class="fa-solid fa-gem"></i> Get Premium · Premium ගන්න</a>
        </div>

        <div class="telegram-cta animate-on-scroll">
          <h2 class="telegram-cta-title"><i class="fa-solid fa-bullhorn"></i> Free Channel · නොමිලේ Channel එක</h2>
          <p class="telegram-cta-desc">නව videos පළමුව දැනගන්න! · Be first to see new previews 🔥</p>
          <a href="https://t.me/ukussafree69" target="_blank" rel="noopener" class="btn btn-primary"><i class="fa-brands fa-telegram"></i> Join @ukussafree69</a>
        </div>
      </div>
      <section class="related-section"><div class="section-header animate-on-scroll"><h2 class="section-title"><span class="icon">🔥</span> More Videos</h2><a href="/" class="section-link">Browse All →</a></div><div class="video-grid animate-on-scroll" id="related-grid"></div></section>
      <div class="tag-cloud-container animate-on-scroll"><h2 class="tag-cloud-title">🏷️ Tags</h2><div id="tag-cloud"></div></div>
      <section class="faq-section-wrapper"><h2 class="faq-section-title animate-on-scroll"><span>❓</span> How to Watch</h2><div class="faq-section" id="faq-section"></div></section>
      <section class="internal-links-section"><h2 class="internal-links-title animate-on-scroll">📁 Categories</h2><div id="internal-links" class="animate-on-scroll"></div></section>
    </div>
  </main>
  <footer class="footer"><div class="container"><div class="footer-inner"><div class="footer-text">© 2026 VideoSLK</div><div class="footer-links"><a href="/">Home</a><a href="/trending.html">Trending</a><a href="https://t.me/ukussafree69" target="_blank">Telegram</a></div></div></div></footer>
  <!-- Mobile-only floating "Unlock Now" CTA -->
  <button class="vslk-sticky-unlock" id="vslk-sticky-unlock" type="button"
          onclick="document.getElementById('unlock-section').scrollIntoView({behavior:'smooth',block:'start'})">
    <i class="fa-solid fa-lock-open"></i> Unlock Now · දැන්ම Unlock කරන්න
  </button>
  <script>
    (function(){
      var btn = document.getElementById('vslk-sticky-unlock');
      var target = document.getElementById('unlock-section');
      if (!btn || !target || !('IntersectionObserver' in window)) return;
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          if (e.isIntersecting) btn.classList.add('hide');
          else btn.classList.remove('hide');
        });
      }, { threshold: 0.25 });
      io.observe(target);
    })();
  </script>
  <script src="/js/unlock.js?v=13" defer></script>
  <script src="/js/videos.js" defer></script>
  <script src="/js/app.js" defer></script>
  <script src="/js/monetag.js" defer></script>
  <script src="/js/seo.js" defer></script>
  <script src="/js/performance.js" defer></script>
</body>
</html>
`;
}

// ===== Main Upload Function =====
async function uploadVideoFiles(slug, caption, description, thumbnailBase64, thumbExtension, duration, state, localPreviewPath) {
  console.log(`\n📤 GitHub upload: ${slug}`);

  const today = new Date().toISOString().split('T')[0];
  const category = detectCategory(caption);
  const tags = generateTags(caption, category);
  const views = randomViews();

  const thumbFilename = thumbnailBase64 ? `${slug}.${thumbExtension || 'jpg'}` : '';
  const thumbPath = thumbFilename ? `assets/thumbs/${thumbFilename}` : '';

  // Encode preview clip to base64 if available — used for autoplay on watch page
  let previewPath = '';
  let previewBase64 = null;
  if (localPreviewPath) {
    try {
      const fs = require('fs');
      if (fs.existsSync(localPreviewPath)) {
        const buf = fs.readFileSync(localPreviewPath);
        // Telegram Bot API caps file size to 20MB but our 5-8s previews are well under 1MB.
        // GitHub Contents API hard-limits a single file PUT to 100MB — fine either way.
        if (buf.length <= 50 * 1024 * 1024) {
          previewBase64 = buf.toString('base64');
          previewPath = `assets/previews/${slug}.mp4`;
          console.log(`   📦 Preview clip ready: ${(buf.length / 1024).toFixed(1)} KB`);
        } else {
          console.log(`   ⚠️ Preview too large (${(buf.length / 1024 / 1024).toFixed(1)}MB), skipping`);
        }
      }
    } catch (e) {
      console.log(`   ⚠️ Preview read failed: ${e.message}`);
    }
  }

  const videoMeta = {
    id: slug, title: caption, description: description,
    thumbnail: thumbPath,
    thumbnailsAll: state.thumbnailsAll || thumbPath,
    preview: previewPath,
    duration: duration.duration || '0:00', durationISO: duration.durationISO || '0S',
    views: views, category: category, tags: tags, date: today,
    telegramFileId: state.fileId || '',
    embedUrl: state.embedUrl || ''
  };

  // Step 1: Upload independent assets in parallel
  console.log(`   ⚡ Starting concurrent uploads...`);
  const uploads = [];

  if (thumbnailBase64 && thumbPath) {
    uploads.push(uploadFile(thumbPath, thumbnailBase64, `Thumb: ${slug}`, true));
  }

  if (previewBase64 && previewPath) {
    uploads.push(uploadFile(previewPath, previewBase64, `Preview: ${slug}`, true));
  }

  const html = generateWatchPage(slug, videoMeta);
  uploads.push(uploadFile(`watch/${slug}.html`, html, `Page: ${slug}`, false));

  await Promise.all(uploads);

  // Step 2: Update shared registries (one after another to avoid SHA conflicts)
  console.log(`   📊 Updating shared registries...`);
  
  const existing = await fetchExistingVideos();
  existing[slug] = videoMeta;
  await uploadFile('js/videos.js', generateVideosJS(existing), `Meta: ${slug}`, false);

  await updateSitemap(slug, videoMeta);

  // Regenerate only the tag pages this video touched — saves API calls vs rebuilding all.
  try {
    const { generateTagPage, buildTagIndex, tagSlug } = require('./tagPageGenerator');
    const tagIdx = buildTagIndex(existing);
    const touched = (videoMeta.tags || []).map(tagSlug).filter(Boolean);
    const uniq = Array.from(new Set(touched));
    for (const k of uniq) {
      if (!tagIdx[k]) continue;
      const html = generateTagPage(k, tagIdx[k]);
      await uploadFile(`tag/${k}.html`, html, `Tag: #${k}`, false);
    }
    if (uniq.length > 0) {
      // Refresh tag index too
      const { generateAllTagPages } = require('./tagPageGenerator');
      const all = generateAllTagPages(existing);
      const indexFile = all.find(f => f.path === 'tag/index.html');
      if (indexFile) await uploadFile(indexFile.path, indexFile.content, indexFile.commit, false);
      console.log(`   🏷  ${uniq.length} tag page(s) refreshed`);
    }
  } catch (e) {
    console.log(`   ⚠️ Tag pages: ${e.message}`);
  }

  console.log(`\n   ✅ Upload complete! (~${thumbnailBase64 ? '3' : '2'} files)`);
  return { success: true, url: `${config.siteUrl}/watch/${slug}.html` };
}

async function updateSitemap(slug, video) {
  try {
    let sm = '';
    const sha = await getFileSHA('sitemap.xml');
    if (sha) {
      const e = await githubRequest('GET', `/repos/${REPO}/contents/sitemap.xml?ref=${BRANCH}`);
      if (e && e.content) sm = Buffer.from(e.content, 'base64').toString('utf8');
    }

    if (!sm) {
      const t = new Date().toISOString().split('T')[0];
      sm = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n  <url><loc>${config.siteUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority><lastmod>${t}</lastmod></url>\n  <url><loc>${config.siteUrl}/trending.html</loc><changefreq>daily</changefreq><priority>0.9</priority></url>\n  <url><loc>${config.siteUrl}/latest.html</loc><changefreq>daily</changefreq><priority>0.9</priority></url>\n  <url><loc>${config.siteUrl}/viral.html</loc><changefreq>daily</changefreq><priority>0.9</priority></url>\n  <!-- VIDEOS_START -->\n  <!-- VIDEOS_END -->\n</urlset>`;
    }

    // Build rich video sitemap entry if metadata is available
    let videoEntry = '';
    if (video.thumbnail && video.preview) {
      const pubDate = video.date || new Date().toISOString().split('T')[0];
      videoEntry = `
    <video:video>
      <video:thumbnail_loc>${config.siteUrl}/${video.thumbnail}</video:thumbnail_loc>
      <video:title>${escHtml(video.title || '')}</video:title>
      <video:description>${escHtml(video.description || video.title || '')}</video:description>
      <video:content_loc>${config.siteUrl}/${video.preview}</video:content_loc>
      <video:publication_date>${pubDate}</video:publication_date>
    </video:video>`;
    }

    const entry = `  <url>\n    <loc>${config.siteUrl}/watch/${slug}.html</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>${videoEntry}\n  </url>\n`;

    if (sm.includes('<!-- VIDEOS_END -->')) {
      sm = sm.replace('  <!-- VIDEOS_END -->', entry + '  <!-- VIDEOS_END -->');
    } else if (sm.includes('</urlset>')) {
      sm = sm.replace('</urlset>', entry + '</urlset>');
    }

    // Ensure new tag URLs are present in the sitemap (deduped)
    try {
      for (const tag of (video.tags || [])) {
        const tagKey = String(tag).toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 30);
        if (!tagKey) continue;
        const tagLoc = `${config.siteUrl}/tag/${tagKey}.html`;
        if (sm.includes(tagLoc)) continue;
        const tagEntry = `  <url>\n    <loc>${tagLoc}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
        if (sm.includes('<!-- VIDEOS_END -->')) sm = sm.replace('  <!-- VIDEOS_END -->', tagEntry + '  <!-- VIDEOS_END -->');
        else sm = sm.replace('</urlset>', tagEntry + '</urlset>');
      }
    } catch (_) {}

    await uploadFile('sitemap.xml', sm, `Sitemap: ${slug}`, false);
  } catch (e) {
    console.log(`   ⚠️ Sitemap: ${e.message}`);
  }
}

module.exports = { uploadVideoFiles, uploadFile, fetchExistingVideos };