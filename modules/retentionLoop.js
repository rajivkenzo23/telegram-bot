/* ============================================
   VideoSLK Bot — Retention Loop System
   Automated user re-engagement through
   scheduled messages and smart follow-ups
   ============================================ */

const { config, formatMessage } = require('../config');
const { readStore, writeStore } = require('./dataManager');

// ===== Retention Configuration =====
const RETENTION_CONFIG = {
    // Delay after video delivery before first follow-up
    firstFollowUp: 10 * 1000,         // 10 seconds

    // Delay for second follow-up with more content
    secondFollowUp: 30 * 60 * 1000,   // 30 minutes

    // Daily digest interval
    dailyDigest: 24 * 60 * 60 * 1000, // 24 hours

    // Max messages per user per day
    maxDailyMessages: 3,

    // Quiet hours (don't send between 11pm - 7am server time)
    quietStart: 23,
    quietEnd: 7
};

// ===== Track Sent Messages =====
const sentMessages = {};

// ===== Check Quiet Hours =====
function isQuietHours() {
    const hour = new Date().getHours();
    if (RETENTION_CONFIG.quietStart > RETENTION_CONFIG.quietEnd) {
        // Wraps past midnight
        return hour >= RETENTION_CONFIG.quietStart || hour < RETENTION_CONFIG.quietEnd;
    }
    return hour >= RETENTION_CONFIG.quietStart && hour < RETENTION_CONFIG.quietEnd;
}

// ===== Check Daily Message Limit =====
function canSendMessage(userId) {
    const today = new Date().toISOString().split('T')[0];
    const key = `${userId}_${today}`;

    if (!sentMessages[key]) {
        sentMessages[key] = 0;
    }

    return sentMessages[key] < RETENTION_CONFIG.maxDailyMessages;
}

// ===== Record Sent Message =====
function recordSentMessage(userId) {
    const today = new Date().toISOString().split('T')[0];
    const key = `${userId}_${today}`;

    if (!sentMessages[key]) {
        sentMessages[key] = 0;
    }

    sentMessages[key]++;
}

// ===== Clean Old Message Records =====
function cleanMessageRecords() {
    const today = new Date().toISOString().split('T')[0];

    Object.keys(sentMessages).forEach(key => {
        if (!key.includes(today)) {
            delete sentMessages[key];
        }
    });
}

// ===== First Follow-Up (10 seconds after delivery) =====
function scheduleFirstFollowUp(bot, chatId, userId, videoTitle) {
    setTimeout(async () => {
        if (!canSendMessage(userId) || isQuietHours()) return;

        try {
            const store = readStore();
            const user = store.users[userId] || {};
            const streak = user.streak || 1;

            const streakMsg = streak > 1 
                ? `🔥 *Your ${streak}-day streak is active!*\nKeep it up to unlock special bonuses.` 
                : `🌟 *Start your daily streak!*\nVisit every day to stay updated with the best clips.`;

            const messages = [
                {
                    text: `🎬 *Video එක බැලුවද?*\n\n` +
                        `${streakMsg}\n\n` +
                        `😍 තව Exclusive videos ගොඩක් තියෙනවා!\n\n` +
                        `🔥 Trending: ${config.siteUrl}/trending.html\n` +
                        `🆕 Latest: ${config.siteUrl}/latest.html`,
                    buttons: [
                        [{ text: '🔥 Trending බලන්න', url: `${config.siteUrl}/trending.html` }],
                        [{ text: '🆕 Latest බලන්න', url: `${config.siteUrl}/latest.html` }],
                        [{ text: '📢 Channel Join කරන්න', url: `https://t.me/${config.channelUsername}` }]
                    ]
                },
                {
                    text: `✅ *Video delivered!*\n\n` +
                        `👉 තව videos unlock කරන්න:\n` +
                        `${config.siteUrl}\n\n` +
                        `📢 Channel: @${config.channelUsername}\n` +
                        `🔔 Notifications on කරගන්න!`,
                    buttons: [
                        [{ text: '🌐 Browse More Videos', url: config.siteUrl }],
                        [{ text: '📢 Join Channel', url: `https://t.me/${config.channelUsername}` }]
                    ]
                },
                {
                    text: `🎉 *Enjoy the video!*\n\n` +
                        `${videoTitle || 'Video'} බැලුවද?\n\n` +
                        `💡 *Did you know?*\n` +
                        `අපි දිනපතා new videos add කරනවා!\n\n` +
                        `🔥 Latest videos: ${config.siteUrl}/latest.html`,
                    buttons: [
                        [{ text: '🆕 Latest Videos', url: `${config.siteUrl}/latest.html` }],
                        [{ text: '⚡ Viral Videos', url: `${config.siteUrl}/viral.html` }]
                    ]
                }
            ];

            const selected = messages[Math.floor(Math.random() * messages.length)];

            await bot.sendMessage(chatId, selected.text, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: selected.buttons
                }
            });

            recordSentMessage(userId);
            console.log(`   📨 First follow-up sent to ${userId}`);

        } catch (error) {
            if (error.response && error.response.statusCode === 403) {
                console.log(`   ⚠️ User ${userId} has blocked the bot`);
            }
        }
    }, RETENTION_CONFIG.firstFollowUp);
}

// ===== Second Follow-Up (30 minutes after delivery) =====
function scheduleSecondFollowUp(bot, chatId, userId) {
    setTimeout(async () => {
        if (!canSendMessage(userId) || isQuietHours()) return;

        try {
            const messages = [
                {
                    text: `🔔 *Reminder!*\n\n` +
                        `📹 නව trending videos add වෙලා තියෙනවා!\n\n` +
                        `👉 ${config.siteUrl}\n\n` +
                        `🔥 Miss කරන්න එපා!`,
                    buttons: [
                        [{ text: '🔥 Check New Videos', url: config.siteUrl }]
                    ]
                },
                {
                    text: `⚡ *New Content Alert!*\n\n` +
                        `අද add වුනු videos:\n` +
                        `👉 ${config.siteUrl}/latest.html\n\n` +
                        `📢 @${config.channelUsername}`,
                    buttons: [
                        [{ text: '🆕 View Latest', url: `${config.siteUrl}/latest.html` }],
                        [{ text: '📢 Channel', url: `https://t.me/${config.channelUsername}` }]
                    ]
                }
            ];

            const selected = messages[Math.floor(Math.random() * messages.length)];

            await bot.sendMessage(chatId, selected.text, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: selected.buttons
                }
            });

            recordSentMessage(userId);
            console.log(`   📨 Second follow-up sent to ${userId}`);

        } catch (error) {
            // Silently handle blocked users
        }
    }, RETENTION_CONFIG.secondFollowUp);
}

// ===== Trigger Retention Loop =====
function triggerRetentionLoop(bot, chatId, userId, videoTitle) {
    // Schedule first follow-up (10 seconds)
    scheduleFirstFollowUp(bot, chatId, userId, videoTitle);

    // Schedule second follow-up (30 minutes)
    scheduleSecondFollowUp(bot, chatId, userId);
}

// ===== Broadcast to All Users =====
async function broadcastMessage(bot, message, buttons) {
    const store = readStore();
    const users = Object.keys(store.users || {});

    console.log(`📣 Broadcasting to ${users.length} users...`);

    let sent = 0;
    let failed = 0;
    let blocked = 0;

    for (const userId of users) {
        if (isQuietHours()) {
            console.log(`   ⏸ Paused broadcast — quiet hours`);
            break;
        }

        try {
            await bot.sendMessage(userId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: buttons ? { inline_keyboard: buttons } : undefined
            });

            sent++;

            // Rate limiting: 30 messages per second max
            await sleep(50);

        } catch (error) {
            if (error.response && error.response.statusCode === 403) {
                blocked++;
            } else {
                failed++;
            }
        }
    }

    console.log(`📣 Broadcast complete: ${sent} sent, ${blocked} blocked, ${failed} failed`);

    return { sent, blocked, failed, total: users.length };
}

// ===== New Video Notification =====
async function notifyNewVideo(bot, videoTitle, videoLink) {
    const message =
        `🔥 *New Video Added!*\n\n` +
        `${videoTitle}\n\n` +
        `▶️ Preview + Unlock:\n` +
        `👉 ${videoLink}\n\n` +
        `📢 @${config.channelUsername}`;

    const buttons = [
        [{ text: '▶️ Watch Now', url: videoLink }],
        [{ text: '📢 Channel', url: `https://t.me/${config.channelUsername}` }]
    ];

    return await broadcastMessage(bot, message, buttons);
}

// ===== Init Retention System =====
function initRetentionSystem(bot) {
    // Clean old message records every hour
    setInterval(cleanMessageRecords, 60 * 60 * 1000);

    // Add broadcast command for admin
    bot.onText(/\/broadcast(.*)/, async (msg, match) => {
        if (msg.from.id !== config.adminId) return;

        const text = (match[1] || '').trim();

        if (!text) {
            await bot.sendMessage(msg.chat.id,
                `📣 *Broadcast System*\n\n` +
                `Usage:\n` +
                `/broadcast Your message here\n\n` +
                `⚠️ This will send to ALL bot users.`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        await bot.sendMessage(msg.chat.id, '📣 Starting broadcast...');

        const result = await broadcastMessage(bot, text, [
            [{ text: '🌐 Visit Website', url: config.siteUrl }]
        ]);

        await bot.sendMessage(msg.chat.id,
            `📣 *Broadcast Complete*\n\n` +
            `✅ Sent: ${result.sent}\n` +
            `🚫 Blocked: ${result.blocked}\n` +
            `❌ Failed: ${result.failed}\n` +
            `📊 Total users: ${result.total}`,
            { parse_mode: 'Markdown' }
        );
    });

    // Add notify command for admin (notify about new video)
    bot.onText(/\/notify (.+)/, async (msg, match) => {
        if (msg.from.id !== config.adminId) return;

        const videoSlug = match[1].trim();
        const { getVideo } = require('./dataManager');
        const video = getVideo(videoSlug);

        if (!video) {
            await bot.sendMessage(msg.chat.id, `❌ Video "${videoSlug}" not found.`);
            return;
        }

        await bot.sendMessage(msg.chat.id, '📣 Sending new video notification...');

        const result = await notifyNewVideo(
            bot,
            video.title,
            video.link || `${config.siteUrl}/watch/${videoSlug}.html`
        );

        await bot.sendMessage(msg.chat.id,
            `📣 *Notification Complete*\n\n` +
            `✅ Sent: ${result.sent}\n` +
            `🚫 Blocked: ${result.blocked}\n` +
            `❌ Failed: ${result.failed}`,
            { parse_mode: 'Markdown' }
        );
    });

    console.log('🔔 Retention loop system initialized');
}

// ===== Helper: Sleep =====
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    triggerRetentionLoop,
    broadcastMessage,
    notifyNewVideo,
    initRetentionSystem,
    scheduleFirstFollowUp,
    scheduleSecondFollowUp
};