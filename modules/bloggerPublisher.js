const { google } = require('googleapis');

async function publishToBlogger(title, slug, description, embedUrl) {
  const clientId = process.env.BLOGGER_CLIENT_ID;
  const clientSecret = process.env.BLOGGER_CLIENT_SECRET;
  const refreshToken = process.env.BLOGGER_REFRESH_TOKEN;
  const blogId = process.env.BLOGGER_BLOG_ID;
  const siteUrl = (process.env.SITE_URL || '').trim();

  if (!clientId || !clientSecret || !refreshToken || !blogId) {
    console.warn("⚠️ Blogger API credentials not fully configured in .env. Skipping Blogger publish.");
    return null;
  }

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const bloggerClient = google.blogger({ version: 'v3', auth: oauth2Client });

    // Premium HTML Layout for Blogspot Post
    const contentHtml = `
<div style="font-family: Arial, sans-serif; background: #0c0c14; color: #ffffff; padding: 20px; border-radius: 12px; border: 1px solid #ff0033; max-width: 600px; margin: 0 auto; box-shadow: 0 10px 30px rgba(255,0,51,0.15);">
  <h2 style="color: #ff0033; font-weight: 800; margin-bottom: 12px; text-shadow: 0 2px 10px rgba(255,0,51,0.35);">${title}</h2>
  
  <div style="margin-bottom: 20px;">
    <!-- Iframe Streamtape Player -->
    <div style="position: relative; width: 100%; padding-top: 56.25%; background: #000; border-radius: 8px; overflow: hidden; border: 1px solid #333;">
      <iframe src="${embedUrl}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" frameborder="0" allowfullscreen scrolling="no"></iframe>
    </div>
  </div>
  
  <p style="font-size: 0.95rem; line-height: 1.6; color: #cccccc; margin-bottom: 20px;">${description}</p>
  
  <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;">
    <a href="${siteUrl}/watch/${slug}.html" target="_blank" style="background: linear-gradient(135deg, #ff0033 0%, #ff6b00 100%); color: #ffffff; padding: 12px; border-radius: 30px; text-align: center; text-decoration: none; font-weight: bold; font-size: 0.95rem; display: block; box-shadow: 0 5px 15px rgba(255,0,51,0.4);">🌐 Watch on Website</a>
    <a href="https://t.me/THEXEducation" target="_blank" style="background: #24A1DE; color: #ffffff; padding: 12px; border-radius: 30px; text-align: center; text-decoration: none; font-weight: bold; font-size: 0.95rem; display: block; box-shadow: 0 5px 15px rgba(36,161,222,0.3);">📢 Join Telegram Channel</a>
    <a href="https://whatsapp.com/channel/0029VbA9drwBadmctNhZGN3S" target="_blank" style="background: #25D366; color: #ffffff; padding: 12px; border-radius: 30px; text-align: center; text-decoration: none; font-weight: bold; font-size: 0.95rem; display: block; box-shadow: 0 5px 15px rgba(37,211,102,0.3);">💚 Join WhatsApp Channel</a>
  </div>
</div>
    `;

    const res = await bloggerClient.posts.insert({
      blogId: blogId,
      requestBody: {
        title: title,
        content: contentHtml,
        labels: ['entertainment', 'viral', 'video']
      }
    });

    console.log(`✅ Blogger post successfully created: ${res.data.url}`);
    return res.data.url;
  } catch (err) {
    console.error("❌ Failed to publish to Blogger:", err.message);
    return null;
  }
}

module.exports = { publishToBlogger };
