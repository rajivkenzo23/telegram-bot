/* ============================================
   VideoSLK Bot — SEO Page Generator
   Generates fully optimized watch pages
   with dynamic SEO, Schema.org, and
   multilingual content
   ============================================ */

const { config } = require('../config');

// ===== Template Configuration =====
const TEMPLATE_CONFIG = {
    siteName: 'VideoSLK',
    siteUrl: config.siteUrl,
    channelUsername: config.channelUsername,
    botLink: config.botLink,
    monetagZone: 218420,
    monetagScript: 'https://quge5.com/88/tag.min.js',
    sponsorLinks: [
        'https://omg10.com/4/10712300',
        'https://omg10.com/4/10695679'
    ],
    themeColor: '#CC0000',
    language: 'en',
    locale: 'en_US'
};

// ===== Escape HTML Entities =====
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ===== Escape for JSON-LD =====
function escapeJsonLd(str) {
    if (!str) return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

// ===== Format Views =====
function formatViews(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// ===== Generate Clean Meta Description =====
function generateMetaDescription(video) {
    // Remove emojis for cleaner meta description
    let desc = (video.description || video.title || '')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
        .trim();

    // Append SEO suffix
    desc += ' Watch the preview and unlock the full video for free on VideoSLK. Trending exclusive content updated daily.';

    // Limit to 160 characters
    if (desc.length > 160) {
        desc = desc.substring(0, 157) + '...';
    }

    return desc;
}

// ===== Generate SEO Title =====
function generateSeoTitle(video) {
    let title = (video.title || 'Exclusive Video').trim();

    // Remove excessive emojis from title for SEO
    const cleanTitle = title.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/gu, '').trim();

    // Keep some emojis but ensure clean title
    if (cleanTitle.length > 10) {
        return `${title} | VideoSLK`;
    }

    return `${title} — Watch Exclusive Video | VideoSLK`;
}

// ===== Generate Tags HTML =====
function generateTagsHtml(tags) {
    if (!tags || !tags.length) return '';

    return tags
        .map(tag => `            <span class="video-tag">#${escapeHtml(tag)}</span>`)
        .join('\n');
}

// ===== Generate Keywords =====
function generateKeywords(video) {
    const keywords = new Set();

    // Add tags
    if (video.tags) {
        video.tags.forEach(t => keywords.add(t));
    }

    // Add common SEO keywords
    keywords.add('viral video');
    keywords.add('trending');
    keywords.add('exclusive content');
    keywords.add('unlock video');
    keywords.add('free video');
    keywords.add(video.category || 'entertainment');

    // Add from title
    const titleWords = (video.title || '')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3);

    titleWords.forEach(w => keywords.add(w.toLowerCase()));

    return Array.from(keywords).slice(0, 15).join(', ');
}

// ===== Generate Breadcrumb JSON-LD =====
function generateBreadcrumbSchema(slug, video) {
    const items = [
        {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: TEMPLATE_CONFIG.siteUrl + '/'
        },
        {
            '@type': 'ListItem',
            position: 2,
            name: getCategoryName(video.category),
            item: TEMPLATE_CONFIG.siteUrl + '/' + (video.category || 'trending') + '.html'
        },
        {
            '@type': 'ListItem',
            position: 3,
            name: stripEmojis(video.title || slug),
            item: TEMPLATE_CONFIG.siteUrl + '/watch/' + slug + '.html'
        }
    ];

    return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items
    });
}

// ===== Generate VideoObject JSON-LD =====
function generateVideoSchema(slug, video) {
    return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: escapeJsonLd(stripEmojis(video.title)),
        description: escapeJsonLd(stripEmojis(video.description)),
        thumbnailUrl: TEMPLATE_CONFIG.siteUrl + '/' + video.thumbnail,
        contentUrl: TEMPLATE_CONFIG.siteUrl + '/' + video.preview,
        embedUrl: TEMPLATE_CONFIG.siteUrl + '/watch/' + slug + '.html',
        uploadDate: (video.date || new Date().toISOString().split('T')[0]) + 'T00:00:00+05:30',
        duration: 'PT' + (video.durationISO || '0S'),
        interactionStatistic: {
            '@type': 'InteractionCounter',
            interactionType: { '@type': 'WatchAction' },
            userInteractionCount: video.views || 0
        },
        publisher: {
            '@type': 'Organization',
            name: 'VideoSLK',
            url: TEMPLATE_CONFIG.siteUrl,
            logo: {
                '@type': 'ImageObject',
                url: TEMPLATE_CONFIG.siteUrl + '/assets/icons/icon-192.png'
            }
        },
        inLanguage: 'si',
        isFamilyFriendly: true
    });
}

// ===== Generate FAQ JSON-LD =====
function generateFaqSchema() {
    return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
            {
                '@type': 'Question',
                name: 'How do I unlock the full video?',
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Complete 2 simple sponsor steps on the video page, then click the Unlock button. You will be redirected to our Telegram bot which sends the full video instantly.'
                }
            },
            {
                '@type': 'Question',
                name: 'Is it free to watch videos?',
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Yes! All videos on VideoSLK are completely free. Simply follow the unlock steps to access full content.'
                }
            },
            {
                '@type': 'Question',
                name: 'How do I get notified about new videos?',
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Join our Telegram channel @ukussa69new to get instant notifications when new trending videos are posted.'
                }
            }
        ]
    });
}

// ===== Generate WebPage JSON-LD =====
function generateWebPageSchema(slug, video) {
    return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: escapeJsonLd(stripEmojis(video.title)) + ' | VideoSLK',
        description: escapeJsonLd(stripEmojis(video.description)),
        url: TEMPLATE_CONFIG.siteUrl + '/watch/' + slug + '.html',
        isPartOf: {
            '@type': 'WebSite',
            name: 'VideoSLK',
            url: TEMPLATE_CONFIG.siteUrl
        },
        primaryImageOfPage: {
            '@type': 'ImageObject',
            url: TEMPLATE_CONFIG.siteUrl + '/' + video.thumbnail
        },
        datePublished: video.date || new Date().toISOString().split('T')[0],
        dateModified: video.date || new Date().toISOString().split('T')[0],
        inLanguage: ['en', 'si']
    });
}

// ===== Helper: Strip Emojis =====
function stripEmojis(str) {
    if (!str) return '';
    return str
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{FE0F}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ===== Helper: Category Display Name =====
function getCategoryName(category) {
    const names = {
        funny: 'Funny Videos',
        sports: 'Sports Videos',
        entertainment: 'Entertainment',
        shocking: 'Shocking Videos',
        trending: 'Trending',
        viral: 'Viral Videos'
    };
    return names[category] || 'Videos';
}

// ===== Generate Watch Page =====
function generateWatchPage(slug, video) {
  const siteUrl = config.siteUrl || 'https://videoslk.eu.cc';
  const pageUrl = `${siteUrl}/watch/${slug}.html`;
  const encodedUrl = encodeURIComponent(pageUrl);
  const thumbUrl = video.thumbnail ? `${siteUrl}/${video.thumbnail}` : '';
  const tagsHtml = (video.tags || []).map(t => `<span class="video-tag">#${escapeHtml(t)}</span>`).join('\n            ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">

  <!-- SEO Meta — Bot replaces these -->
  <title>${escapeHtml(video.title)} | VideoSLK</title>
  <meta name="description" content="${escapeHtml(video.description)} Watch the preview and unlock the full video for free on VideoSLK.">
  <meta name="keywords" content="${(video.tags || []).join(', ')}, viral video, trending, exclusive, unlock video">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="https://videoslk.eu.cc/watch/${slug}.html">

  <!-- Open Graph -->
  <meta property="og:type" content="video.other">
  <meta property="og:title" content="${escapeHtml(video.title)} | VideoSLK">
  <meta property="og:description" content="${escapeHtml(video.description)}">
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
  <meta name="twitter:title" content="${escapeHtml(video.title)} | VideoSLK">
  <meta name="twitter:description" content="${escapeHtml(video.description)}">
  <meta name="twitter:image" content="https://videoslk.eu.cc/${video.thumbnail || ''}">
  <meta name="twitter:player" content="https://videoslk.eu.cc/${video.preview || ''}">

  <!-- Schema.org VideoObject -->
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"VideoObject","name":"${escapeHtml(video.title)}","description":"${escapeHtml(video.description)}","thumbnailUrl":"https://videoslk.eu.cc/${video.thumbnail || ''}","contentUrl":"https://videoslk.eu.cc/${video.preview || ''}","uploadDate":"${video.date}","duration":"PT${video.durationISO || '0S'}","interactionStatistic":{"@type":"InteractionCounter","interactionType":{"@type":"WatchAction"},"userInteractionCount":${video.views || 0}},"publisher":{"@type":"Organization","name":"VideoSLK","url":"https://videoslk.eu.cc"}}
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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
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
      <a href="/" class="logo"><div class="logo-icon">▶</div><div class="logo-text">VIDEO<span>SLK</span></div></a>
      <nav class="nav-links">
        <a href="/" class="nav-link">🏠 Home</a>
        <a href="/trending.html" class="nav-link">🔥 Trending</a>
        <a href="/latest.html" class="nav-link">🆕 Latest</a>
        <a href="/viral.html" class="nav-link">⚡ Viral</a>
        <a href="https://t.me/ukussa69new" target="_blank" rel="noopener" class="nav-link nav-telegram">📢 Telegram</a>
      </nav>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="search-toggle-btn" aria-label="Search">🔍</button>
        <button class="mobile-menu-btn" aria-label="Menu"><span></span><span></span><span></span></button>
      </div>
    </div>
  </header>
  <div class="search-overlay">
    <div class="search-header"><span class="search-icon">🔍</span><input type="search" id="search-input" class="search-input" placeholder="Search videos..." autocomplete="off"><button class="search-close-btn">✕</button></div>
    <div class="search-results-container" id="search-results"></div>
  </div>
  <main class="main">
    <div class="container watch-page">
      <div class="breadcrumb-container" id="breadcrumbs"></div>
      <div class="watch-layout" data-video-id="${slug}">

        <!-- AUTOPLAY PREVIEW (muted loop) + title + UNLOCK above the fold -->
        <div class="preview-thumb-wrapper animate-on-scroll" id="preview-wrapper">
          <span class="preview-badge">⚡ PREVIEW</span>
          <video class="preview-video" src="/${video.preview || ''}" autoplay muted loop playsinline poster="/${video.thumbnail || ''}" preload="auto"></video>
          <div class="preview-gradient"></div>
          <div class="preview-overlay">
            <div class="preview-lock">🔒</div>
            <div class="preview-lock-text">Full Video Locked</div>
            <div class="preview-lock-sub">සම්පූර්ණ Video එක Lock කරලා — පහත steps complete කරන්න</div>
            <div class="preview-duration-badge">⏱ ${video.duration || '0:00'} · ${formatViews(video.views || 0)} views</div>
            <button type="button" class="preview-cta-btn" onclick="document.getElementById('unlock-section').scrollIntoView({behavior:'smooth',block:'start'})" style="margin-top:14px;background:linear-gradient(135deg,#CC0000,#FF6B00);color:#fff;border:0;padding:11px 24px;border-radius:50px;font-weight:800;font-size:0.95rem;cursor:pointer;box-shadow:0 8px 24px rgba(204,0,0,0.4);">🔓 Unlock Now — දැන්ම Unlock කරන්න ↓</button>
          </div>
        </div>

        <h1 class="video-title" style="margin:16px 0 6px;font-size:1.5rem;font-weight:900;line-height:1.25;">${escapeHtml(video.title)}</h1>
        <div class="video-meta" style="display:flex;gap:14px;flex-wrap:wrap;color:var(--text-muted);font-size:0.85rem;margin-bottom:10px;">
          <span>👁 ${formatViews(video.views || 0)} views</span>
          <span>📅 ${video.date}</span>
          <span>⏱ ${video.duration || '0:00'}</span>
        </div>

        <!-- ===== UNLOCK SECTION ===== -->
        <div class="verification-card animate-on-scroll required" id="unlock-section">
          <div class="verification-progress-bar">
            <div class="verification-progress-fill" id="verification-progress-fill"></div>
          </div>
          <div class="verification-file-info">
            <div class="file-icon" id="file-info-icon">🎥</div>
            <div class="file-details">
              <div class="file-name" id="file-info-name">${escapeHtml(video.title)}</div>
              <div class="file-meta" id="file-info-meta">${formatViews(video.views || 0)} views · ${video.duration || '0:00'}</div>
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
          <a href="https://wa.me/?text=${encodedUrl}" target="_blank" rel="noopener" class="share-btn" title="WhatsApp">💬</a>
          <a href="https://t.me/share/url?url=${encodedUrl}" target="_blank" rel="noopener" class="share-btn" title="Telegram">✈️</a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}" target="_blank" rel="noopener" class="share-btn" title="Facebook">📘</a>
          <button class="share-btn" title="Copy link" onclick="navigator.clipboard.writeText(window.location.href);this.textContent='✅';setTimeout(()=>this.textContent='🔗',2000)">🔗</button>
        </div>

        <div class="video-description animate-on-scroll" style="margin-top:12px;">
          <p>${escapeHtml(video.description)}</p>
        </div>

        <div class="premium-cta animate-on-scroll" style="background:linear-gradient(135deg,#CC0000 0%,#FF6B00 100%);border-radius:var(--radius-lg);padding:20px;margin:18px 0;text-align:center;color:#fff;">
          <h2 style="margin:0 0 4px;font-size:1.3rem;font-weight:900;">⭐ Skip the Ads — Go Premium</h2>
          <p style="margin:0 0 4px;opacity:0.95;font-size:0.92rem;font-weight:600;">⭐ Ads නැතුවම බලන්න — Premium වෙන්න</p>
          <p style="margin:0 0 12px;opacity:0.95;font-size:0.88rem;">Full HD · Uncut · NEW videos daily · දිනපතා නව videos · One-time Telegram Stars payment</p>
          <a href="https://t.me/ukussa_69_bot?start=premium" target="_blank" rel="noopener" class="btn" style="background:#fff;color:#CC0000;font-weight:800;padding:10px 22px;border-radius:50px;text-decoration:none;display:inline-block;">💎 Get Premium · Premium ගන්න</a>
        </div>

        <div class="telegram-cta animate-on-scroll">
          <h2 class="telegram-cta-title">📢 Free Channel · නොමිලේ Channel එක</h2>
          <p class="telegram-cta-desc">නව videos පළමුව දැනගන්න! · Be first to see new previews 🔥</p>
          <a href="https://t.me/ukussafree69" target="_blank" rel="noopener" class="btn btn-primary">🚀 Join @ukussafree69</a>
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
    🔓 Unlock Now · දැන්ම Unlock කරන්න
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

module.exports = {
    generateWatchPage,
    generateSeoTitle,
    generateMetaDescription,
    generateKeywords,
    generateBreadcrumbSchema,
    generateVideoSchema,
    generateFaqSchema,
    generateWebPageSchema,
    generateTagsHtml,
    escapeHtml,
    escapeJsonLd,
    stripEmojis,
    getCategoryName,
    formatViews
};