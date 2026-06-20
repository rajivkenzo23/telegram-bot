/* ============================================
   VideoSLK Bot — User Handler
   Manages user interactions, video delivery, premium upsell
   ============================================ */

const { config, formatMessage } = require('../config');
const { getVideo, recordUser, recordDelivery } = require('./dataManager');
const { isAdmin } = require('./adminHandler');
const { triggerRetentionLoop } = require('./retentionLoop');
const { validateUnlockToken, looksLikeToken } = require('./unlockToken');
const { recordChannelDelivery } = require('./channelRegistry');
const { checkMembership, buildGatePrompt, clearMembershipCache } = require('./forceSubscribe');

// Pending "deliver after gate passes" — when user passes gate via recheck button, we need
// to know which video they were trying to unlock. Keyed by userId.
const pendingDeliveries = new Map();

function recordRefDelivery(ref) {
    if (!ref) return;
    try { recordChannelDelivery(ref); } catch (_) {}
}

// ===== Basic in-memory rate limiter =====
// Bucket per (userId, action) — protects against bot abuse and accidental loops.
const rateBuckets = new Map();
function rateAllow(userId, action, limit = 5, windowMs = 60_000) {
    const key = `${userId}:${action}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
        bucket.count = 0;
        bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    return bucket.count <= limit;
}
// Prune rate buckets periodically
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateBuckets) {
        if (now > v.resetAt + 60_000) rateBuckets.delete(k);
    }
}, 5 * 60_000);

function initUserHandler(bot) {
    // Log all incoming messages for diagnostics
    bot.on('message', (msg) => {
        const text = msg.text || '';
        console.log(`📥 [Incoming Message] Chat: ${msg.chat.id}, User: ${msg.from.id} (${msg.from.username || msg.from.first_name || 'no_name'}), Text: "${text}"`);
    });

    // ===== /start Command =====
    bot.onText(/\/start(.*)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const username = msg.from.username || '';
        const firstName = msg.from.first_name || '';
        const startParam = (match[1] || '').trim();

        recordUser(userId, username);

        if (!rateAllow(userId, 'start', 8, 60_000)) {
            await bot.sendMessage(chatId, formatMessage(config.messages.rateLimited), { parse_mode: 'Markdown' });
            return;
        }

        // Admin (no start param) → admin welcome
        if (isAdmin(userId) && !startParam) {
            await bot.sendMessage(chatId,
                formatMessage(config.messages.adminWelcome),
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📊 Stats', callback_data: 'admin_stats' }],
                            [{ text: '📋 Video List', callback_data: 'admin_list' }],
                            [{ text: '🌐 Website', url: config.siteUrl }]
                        ]
                    }
                }
            );
            return;
        }

        // /start with parameter → premium upsell OR unlock token OR legacy raw slug
        if (startParam) {
            if (startParam === 'premium' || startParam.startsWith('premium_')) {
                await sendPremiumInvoice(bot, chatId);
                return;
            }
            await handleUnlockDelivery(bot, chatId, userId, startParam, firstName);
            return;
        }

        // Plain /start — show force-subscribe gate first (non-admins)
        if (!isAdmin(userId)) {
            const gate = await checkMembership(bot, userId);
            if (!gate.ok) {
                const prompt = buildGatePrompt(gate.missing, 'fsub_recheck');
                await bot.sendMessage(chatId,
                    `👋 *Hi ${firstName || 'there'}! Welcome to VideoSLK* · *ආයුබෝවන්!*\n\n` +
                    prompt.text,
                    { parse_mode: 'Markdown', reply_markup: prompt.reply_markup });
                return;
            }
        }

        // Welcome screen — build channel join URLs (invite-link first, then @username)
        const channelUrl = (invite, username) => invite || (username ? `https://t.me/${username}` : null);
        const mainUrl = channelUrl(config.mainChannelInviteLink, config.mainChannelUsername);
        const freeUrl = channelUrl(config.freeChannelInviteLink, config.freeChannelUsername);
        const backupUrl = channelUrl(config.backupChannelInviteLink, config.backupChannelUsername);

        const channelListLines = [
            mainUrl   ? `🦅 Main: ${config.mainChannelUsername ? '@' + config.mainChannelUsername : mainUrl}`   : null,
            freeUrl   ? `🆓 Free: ${config.freeChannelUsername ? '@' + config.freeChannelUsername : freeUrl}`   : null,
            backupUrl ? `🛡 Backup: ${config.backupChannelUsername ? '@' + config.backupChannelUsername : backupUrl}` : null
        ].filter(Boolean).join('\n');

        const welcomeText = firstName
            ? `🦅 *ආයුබෝවන් ${firstName}!*\n\n` +
              `Welcome to *VideoSLK* — Sri Lanka's hub for exclusive viral videos.\n` +
              `VideoSLK එකට සාදරයෙන් පිළිගන්නවා! 🎉\n\n` +
              `🌐 Browse + unlock: ${config.siteUrl}\n` +
              `⭐ Ads නැතුව full HD ඕනේද? → /premium\n\n` +
              (channelListLines ? `📡 *Our Channels:*\n${channelListLines}` : '')
            : formatMessage(config.messages.welcome);

        const channelButtonRow = [];
        if (mainUrl)   channelButtonRow.push({ text: '🦅 Main',   url: mainUrl   });
        if (freeUrl)   channelButtonRow.push({ text: '🆓 Free',   url: freeUrl   });
        const inline_keyboard = [
            [{ text: '🌐 Browse Videos · Videos බලන්න', url: config.siteUrl }],
            [{ text: '⭐ Get Premium · Premium ගන්න', callback_data: 'show_premium' }]
        ];
        if (channelButtonRow.length) inline_keyboard.push(channelButtonRow);
        if (backupUrl) inline_keyboard.push([{ text: '🛡 Backup Channel', url: backupUrl }]);

        await bot.sendMessage(chatId, welcomeText, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard }
        });
    });

    // ===== Combined callback_query handler =====
    // Previously two modules registered separate listeners; consolidating here.
    bot.on('callback_query', async (query) => {
        const chatId = query.message && query.message.chat ? query.message.chat.id : null;
        const data = query.data || '';
        if (!chatId) return;

        try {
            // Admin callbacks
            if (data === 'admin_stats' && isAdmin(query.from.id)) {
                const { getStats } = require('./dataManager');
                const stats = getStats();
                await bot.answerCallbackQuery(query.id);
                await bot.sendMessage(chatId,
                    `📊 *Bot Statistics*\n\n📹 Videos: ${stats.totalVideos}\n👥 Users: ${stats.totalUsers}\n📤 Deliveries: ${stats.totalDeliveries}`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            if (data === 'admin_list' && isAdmin(query.from.id)) {
                const { getAllVideos } = require('./dataManager');
                const videos = getAllVideos();
                const keys = Object.keys(videos);
                await bot.answerCallbackQuery(query.id);
                if (keys.length === 0) { await bot.sendMessage(chatId, '📹 No videos yet.'); return; }
                let list = '📋 *Recent Videos:*\n\n';
                keys.slice(-10).forEach((key, i) => {
                    list += `${i + 1}. ${videos[key].title || key}\n   🔗 ${config.siteUrl}/watch/${key}.html\n\n`;
                });
                await bot.sendMessage(chatId, list, { parse_mode: 'Markdown' });
                return;
            }

            // Generic user callbacks
            if (data === 'browse_more') {
                await bot.answerCallbackQuery(query.id);
                await bot.sendMessage(chatId,
                    `🔥 *තව Videos බලන්න!*\n\n🌐 ${config.siteUrl}\n🔥 Trending: ${config.siteUrl}/trending.html`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔥 Trending', url: `${config.siteUrl}/trending.html` }],
                                [{ text: '🆕 Latest', url: `${config.siteUrl}/latest.html` }]
                            ]
                        }
                    }
                );
                return;
            }

            if (data === 'show_premium') {
                await bot.answerCallbackQuery(query.id);
                await sendPremiumInvoice(bot, chatId);
                return;
            }

            if (data === 'fsub_recheck') {
                // Bust cache for this user so we re-check from Telegram fresh
                clearMembershipCache(query.from.id);
                const gate = await checkMembership(bot, query.from.id);
                if (gate.ok) {
                    await bot.answerCallbackQuery(query.id, { text: '✅ Verified! Sending video...', show_alert: false });
                    const pending = pendingDeliveries.get(query.from.id);
                    if (pending) {
                        pendingDeliveries.delete(query.from.id);
                        await deliverVideo(bot, chatId, query.from.id, pending.videoId, pending.firstName, pending.ref);
                    } else {
                        await bot.sendMessage(chatId,
                            '✅ *All channels joined!* Open a watch page from the website to get your video.\n\n' +
                            '✅ *සියලුම channels join කරා!* Website එකෙන් video එකක් unlock කරන්න.',
                            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🌐 Open Website', url: config.siteUrl }]] } });
                    }
                } else {
                    await bot.answerCallbackQuery(query.id, {
                        text: '⚠️ Still missing ' + gate.missing.length + ' channel(s). Join them and tap again.',
                        show_alert: true
                    });
                }
                return;
            }

            // Unknown callbacks — ack to clear loading state
            await bot.answerCallbackQuery(query.id).catch(() => {});
        } catch (err) {
            console.error('callback_query error:', err.message);
        }
    });

    // ===== /premium → Stars invoice =====
    bot.onText(/^\/premium/, async (msg) => {
        if (!rateAllow(msg.from.id, 'premium', 5, 60_000)) {
            await bot.sendMessage(msg.chat.id, formatMessage(config.messages.rateLimited), { parse_mode: 'Markdown' });
            return;
        }
        await sendPremiumInvoice(bot, msg.chat.id);
    });

    // ===== Pre-checkout (required for Stars payments) =====
    bot.on('pre_checkout_query', async (query) => {
        try {
            await bot.answerPreCheckoutQuery(query.id, true);
        } catch (err) {
            console.error('pre_checkout_query failed:', err.message);
            try { await bot.answerPreCheckoutQuery(query.id, false, { error_message: 'Payment failed, please retry.' }); } catch (_) {}
        }
    });

    // ===== successful_payment → grant premium =====
    bot.on('successful_payment', async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const payment = msg.successful_payment;
        console.log(`💎 Stars payment received from ${userId}: ${payment.total_amount} ${payment.currency}`);

        // Mark user as premium in DB
        try {
            const { readStore, writeStore } = require('./dataManager');
            const store = readStore();
            if (!store.users[userId]) store.users[userId] = { firstSeen: new Date().toISOString() };
            store.users[userId].premium = true;
            store.users[userId].premiumSince = new Date().toISOString();
            store.users[userId].lastPayment = {
                amount: payment.total_amount,
                currency: payment.currency,
                providerChargeId: payment.provider_payment_charge_id || '',
                telegramChargeId: payment.telegram_payment_charge_id || ''
            };
            writeStore(store);
        } catch (e) {
            console.error('Failed to mark premium user:', e.message);
        }

        const thanks = formatMessage(config.messages.premiumThankYou, {
            INVITE_LINK: config.premiumInviteLink || `https://t.me/${config.premiumChannelUsername}`
        });
        await bot.sendMessage(chatId, thanks, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💎 Join Premium Channel', url: config.premiumInviteLink || `https://t.me/${config.premiumChannelUsername}` }]
                ]
            }
        });
    });

    // ===== Catch-all text (NOT admins, NOT commands, NOT media) =====
    // Important: ignore admin so the upload caption flow in adminHandler still works.
    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/') || isAdmin(msg.from.id)) return;
        if (msg.video || msg.document || msg.photo) return;
        if (msg.successful_payment) return;

        if (!rateAllow(msg.from.id, 'echo', 3, 60_000)) return;

        const chatId = msg.chat.id;
        await bot.sendMessage(chatId,
            `🎬 *VideoSLK Bot*\n\n` +
            `Videos unlock කරන්න website එකට යන්න:\n👉 ${config.siteUrl}\n\n` +
            `⭐ /premium — get uncut HD videos with no ads`,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🌐 Website', url: config.siteUrl }],
                    [{ text: '⭐ Get Premium', callback_data: 'show_premium' }]
                ]}
            }
        );
    });
}

// ===== Unlock token → deliver video =====
async function handleUnlockDelivery(bot, chatId, userId, startParam, firstName) {
    let videoId = null;
    let tokenValid = false;
    let reason = '';

    let ref = '';
    if (looksLikeToken(startParam)) {
        const result = validateUnlockToken(startParam);
        tokenValid = result.ok;
        videoId = result.videoId;
        ref = result.ref || '';
        reason = result.reason || '';
        if (!tokenValid) {
            console.log(`   ⛔ Token rejected: ${reason} (videoId=${videoId})`);
            // Token invalid/expired → friendly redirect, NO video.
            await bot.sendMessage(chatId,
                formatMessage(config.messages.tokenInvalid, { SITE_URL: config.siteUrl }),
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🌐 Go to website', url: config.siteUrl }],
                            [{ text: '⭐ Skip ads — Premium', callback_data: 'show_premium' }]
                        ]
                    }
                }
            );
            return;
        }
    } else {
        // Legacy raw slug — only honor if HMAC secret is not configured yet
        // (smooth migration; once secret is set, raw slugs are refused)
        const { config: cfg } = require('../config');
        if (cfg.unlockHmacSecret && cfg.unlockHmacSecret.length >= 16) {
            await bot.sendMessage(chatId,
                formatMessage(config.messages.tokenInvalid, { SITE_URL: config.siteUrl }),
                { parse_mode: 'Markdown' }
            );
            return;
        }
        videoId = startParam.replace(/[^a-z0-9-]/gi, '').toLowerCase();
    }

    // Force-subscribe gate — admin bypasses
    if (!isAdmin(userId)) {
        const gate = await checkMembership(bot, userId);
        if (!gate.ok) {
            // Remember the intent so the "I joined — Try again" button can deliver after recheck
            pendingDeliveries.set(userId, { videoId, firstName, ref, at: Date.now() });
            const prompt = buildGatePrompt(gate.missing, 'fsub_recheck');
            await bot.sendMessage(chatId, prompt.text, { parse_mode: 'Markdown', reply_markup: prompt.reply_markup });
            return;
        }
    }
    await deliverVideo(bot, chatId, userId, videoId, firstName, ref);
}

// ===== Deliver Video =====
async function deliverVideo(bot, chatId, userId, videoId, firstName, ref) {
    console.log(`📤 Delivering video ${videoId} to user ${userId}${ref ? ` (ref=${ref})` : ''}`);
    const video = getVideo(videoId);

    if (!video || !video.fileId) {
        await bot.sendMessage(chatId, formatMessage(config.messages.noVideo), {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🌐 Website', url: config.siteUrl }]] }
        });
        return;
    }

    try {
        const deliveryCaption = firstName
            ? `🎬 *${firstName}, ඔබේ Video මෙන්න!*\n\n✅ Full video ඉහතින් බලන්න\n\n` +
              `⭐ Want ads-free + new videos daily? /premium`
            : formatMessage(config.messages.videoSent);

        await bot.sendVideo(chatId, video.fileId, {
            caption: deliveryCaption,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔥 තව Videos බලන්න!', callback_data: 'browse_more' }],
                    [{ text: '⭐ Premium (no ads)', callback_data: 'show_premium' }],
                    [{ text: '📢 Free Channel', url: `https://t.me/${config.freeChannelUsername}` }]
                ]
            }
        });

        recordDelivery(userId);
        recordRefDelivery(ref);
        triggerRetentionLoop(bot, chatId, userId, video.title);
    } catch (error) {
        console.error('❌ Error delivering video:', error.message);
        try {
            await bot.sendDocument(chatId, video.fileId, {
                caption: formatMessage(config.messages.videoSent),
                parse_mode: 'Markdown'
            });
            recordDelivery(userId);
            recordRefDelivery(ref);
            triggerRetentionLoop(bot, chatId, userId, video.title);
        } catch (docError) {
            await bot.sendMessage(chatId, `❌ Video send failed. Please try again later.`, { parse_mode: 'Markdown' });
        }
    }
}

// ===== Stars invoice =====
async function sendPremiumInvoice(bot, chatId) {
    const price = config.premiumStarsPrice || 150;
    const description = formatMessage(config.messages.premiumInvoice, { STARS: price });

    try {
        await bot.sendInvoice(chatId,
            'VideoSLK Premium',                      // title
            description.replace(/[*_`]/g, ''),       // description (Stars dialog is plain text)
            JSON.stringify({ kind: 'premium_lifetime', uid: chatId }),  // payload
            '',                                       // provider_token — empty for Stars
            'XTR',                                    // currency = Telegram Stars
            [{ label: 'Lifetime Premium Access', amount: price }]
        );
    } catch (err) {
        console.error('sendInvoice failed:', err.message);
        // Fallback to manual invite link if Stars sale isn't yet enabled
        await bot.sendMessage(chatId,
            `⭐ *Premium Access*\n\nContact admin or use this link:\n${config.premiumInviteLink || 'Coming soon!'}`,
            { parse_mode: 'Markdown' }
        );
    }
}

module.exports = { initUserHandler };
