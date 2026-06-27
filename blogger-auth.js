const { google } = require('googleapis');
const input = require('input');

(async () => {
  console.log("==========================================================================");
  console.log("             Blogger API v3 OAuth2 Session Authorizer                     ");
  console.log("==========================================================================\n");

  const clientId = await input.text("1. Enter your Google Client ID: ");
  const clientSecret = await input.text("2. Enter your Google Client Secret: ");
  
  // Using OOB redirect URL for desktop/standalone authentication
  const redirectUri = 'urn:ietf:wg:oauth:2.0:oob';
  
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // crucial to get the refresh token
    prompt: 'consent',      // forces Google to return refresh token every time
    scope: ['https://www.googleapis.com/auth/blogger']
  });

  console.log("\n==========================================================================");
  console.log("👉 Visit this URL in your browser to authorize your account:");
  console.log("==========================================================================");
  console.log(authUrl);
  console.log("==========================================================================\n");

  const code = await input.text("3. Enter the Authorization Code shown in the browser: ");

  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    console.log("\n==========================================================================");
    console.log("SUCCESSFULLY AUTHENTICATED!");
    console.log("Copy the Refresh Token and Blog ID to your .env file:");
    console.log("==========================================================================");
    console.log(`BLOGGER_CLIENT_ID=${clientId}`);
    console.log(`BLOGGER_CLIENT_SECRET=${clientSecret}`);
    console.log(`BLOGGER_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("==========================================================================\n");
  } catch (err) {
    console.error("❌ Failed to exchange code for tokens:", err.message);
  }
})();
