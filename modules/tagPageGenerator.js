/* ============================================
   VideoSLK Bot — SEO Tag-page Generator
   Builds /tag/<tagSlug>.html for every unique tag.
   Long-tail SEO win: each tag becomes its own indexable, themed list page.

   Caller passes the full videos registry (same shape as videos.js' VIDEOS_DATA).
   ============================================ */

const { config } = require('../config');

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tagSlug(tag) {
  return String(tag || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30);
}

function fmtViews(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n || 0);
}

/**
 * Build map: tag → [video, ...] (sorted by views desc).
 */
function buildTagIndex(videosMap) {
  const idx = {};
  for (const v of Object.values(videosMap || {})) {
    for (const t of (v.tags || [])) {
      const slug = tagSlug(t);
      if (!slug) continue;
      if (!idx[slug]) idx[slug] = { displayName: t, videos: [] };
      idx[slug].videos.push(v);
    }
  }
  for (const k of Object.keys(idx)) {
    idx[k].videos.sort((a, b) => (b.views || 0) - (a.views || 0));
  }
  return idx;
}

function generateTagPage(tagKey, bucket) {
  const siteUrl = config.siteUrl;
  const pageUrl = `${siteUrl}/tag/${tagKey}.html`;
  const tag = bucket.displayName;
  const videos = bucket.videos;
  const title = `${tag.charAt(0).toUpperCase() + tag.slice(1)} Videos | VideoSLK`;
  const desc = `${videos.length} viral ${tag} videos. Watch and unlock free on VideoSLK.`;
  const cards = videos.slice(0, 60).map(v => `
      <a href="/watch/${escHtml(v.id)}.html" class="video-card">
        <div class="card-thumbnail">
          ${v.thumbnail ? `<img src="/${escHtml(v.thumbnail)}" alt="${escHtml(v.title)}" loading="lazy" width="320" height="180">` : ''}
          <span class="duration">${escHtml(v.duration || '0:00')}</span>
          <div class="card-play-btn"></div>
        </div>
        <div class="card-info">
          <h3 class="card-title">${escHtml(v.title)}</h3>
          <div class="card-meta"><span>👁 ${fmtViews(v.views)}</span></div>
        </div>
      </a>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta name="keywords" content="${escHtml(tag)}, viral video, trending, telegram videos">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${pageUrl}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${siteUrl}/api/og?t=${encodeURIComponent(tag + ' videos')}">
  <script type="application/ld+json">
  ${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description: desc,
    url: pageUrl,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: videos.length,
      itemListElement: videos.slice(0, 20).map((v, i) => ({
        '@type': 'ListItem', position: i + 1, url: `${siteUrl}/watch/${v.id}.html`, name: v.title
      }))
    }
  })}
  </script>
  <meta name="theme-color" content="#CC0000">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/icon-32.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
  <script src="https://quge5.com/88/tag.min.js" data-zone="218420" async data-cfasync="false"></script>
</head>
<body>
  <header class="header">
    <div class="header-inner">
      <a href="/" class="logo"><div class="logo-icon">▶</div><div class="logo-text">VIDEO<span>SLK</span></div></a>
      <nav class="nav-links">
        <a href="/" class="nav-link">🏠 Home</a>
        <a href="/trending.html" class="nav-link">🔥 Trending</a>
        <a href="/latest.html" class="nav-link">🆕 Latest</a>
        <a href="/viral.html" class="nav-link">⚡ Viral</a>
      </nav>
    </div>
  </header>
  <main class="main">
    <div class="container">
      <div class="ad-slot ad-slot-top"><!-- MONETAG --></div>
      <section style="padding:30px 0 10px;">
        <h1 style="font-size:2rem;font-weight:900;margin:0 0 6px;">#${escHtml(tag)} <span style="opacity:0.6;font-size:1rem;font-weight:500;">(${videos.length} videos)</span></h1>
        <p style="color:var(--text-muted);margin:0 0 18px;">All ${escHtml(tag)} videos — preview + unlock free.</p>
      </section>
      <div class="video-grid">
        ${cards || '<p>No videos in this tag yet.</p>'}
      </div>
      <div class="ad-slot ad-slot-footer" style="margin-top:30px"><!-- MONETAG --></div>
    </div>
  </main>
  <footer class="footer"><div class="container"><div class="footer-inner"><div class="footer-text">© ${new Date().getFullYear()} VideoSLK</div></div></div></footer>
  <script src="/js/videos.js" defer></script>
  <script src="/js/app.js" defer></script>
</body>
</html>`;
}

/**
 * Generate every tag page and an index. Returns an array of file uploads.
 * Caller (githubUploader) handles the actual PUTs.
 */
function generateAllTagPages(videosMap) {
  const idx = buildTagIndex(videosMap);
  const files = [];
  const tagKeys = Object.keys(idx).sort();

  for (const k of tagKeys) {
    files.push({
      path: `tag/${k}.html`,
      content: generateTagPage(k, idx[k]),
      commit: `Tag page: #${k}`
    });
  }

  // Tag index page
  files.push({
    path: 'tag/index.html',
    content: generateTagIndexPage(idx),
    commit: 'Tag index'
  });

  return files;
}

function generateTagIndexPage(idx) {
  const siteUrl = config.siteUrl;
  const items = Object.entries(idx)
    .sort((a, b) => b[1].videos.length - a[1].videos.length)
    .map(([k, v]) => `<a href="/tag/${escHtml(k)}.html" class="tag-pill" style="display:inline-block;margin:5px;padding:8px 14px;background:linear-gradient(135deg,#CC0000,#FF6B00);color:#fff;border-radius:50px;text-decoration:none;font-weight:600;">#${escHtml(v.displayName)} (${v.videos.length})</a>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Browse by Tag | VideoSLK</title>
  <meta name="description" content="Browse all video tags on VideoSLK — ${Object.keys(idx).length} categories of viral content.">
  <link rel="canonical" href="${siteUrl}/tag/">
  <meta name="theme-color" content="#CC0000">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <header class="header"><div class="header-inner">
    <a href="/" class="logo"><div class="logo-icon">▶</div><div class="logo-text">VIDEO<span>SLK</span></div></a>
  </div></header>
  <main class="main">
    <div class="container" style="padding:40px 0;">
      <h1>🏷 Browse by Tag</h1>
      <p>Pick a category to see all videos with that tag.</p>
      <div style="margin-top:20px;">${items || '<p>No tags yet.</p>'}</div>
    </div>
  </main>
</body>
</html>`;
}

module.exports = {
  buildTagIndex,
  generateTagPage,
  generateAllTagPages,
  tagSlug
};
