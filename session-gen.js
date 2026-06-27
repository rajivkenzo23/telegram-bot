const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");

const apiId = 35481411;
const apiHash = "5db076b70a26a9e703fcd7c27ea8fc58";
const stringSession = new StringSession("");

(async () => {
  console.log("Starting Main Bot Telegram Session Generator...");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("Please enter your phone number (+countrycode...): "),
    password: async () => await input.text("Please enter your 2FA password (if enabled, press enter if none): "),
    phoneCode: async () => await input.text("Please enter the OTP code you received: "),
    onError: (err) => console.log(err),
  });

  console.log("\n==========================================================================");
  console.log("SUCCESSFULLY LOGGED IN!");
  console.log("Copy the following Session String and save it to your main bot's .env file:");
  console.log("==========================================================================");
  console.log(client.session.save());
  console.log("==========================================================================\n");

  await client.destroy();
})();
