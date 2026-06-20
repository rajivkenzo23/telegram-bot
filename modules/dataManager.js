/* ============================================
   VideoSLK Bot — Data Manager
   Panel Compatible Paths
   ============================================ */

const fs = require('fs');
const path = require('path');

// Use path relative to this file's location
const DATA_PATH = path.join(__dirname, '..', 'data', 'videoStore.json');

function ensureDataDir() {
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readStore() {
    ensureDataDir();

    try {
        if (!fs.existsSync(DATA_PATH)) {
            const initial = {
                videos: {},
                stats: { totalVideos: 0, totalDeliveries: 0, totalUsers: 0 },
                users: {}
            };
            fs.writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2));
            return initial;
        }

        const raw = fs.readFileSync(DATA_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('❌ Error reading data store:', err.message);
        return {
            videos: {},
            stats: { totalVideos: 0, totalDeliveries: 0, totalUsers: 0 },
            users: {}
        };
    }
}

function writeStore(data) {
    ensureDataDir();

    try {
        fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (err) {
        console.error('❌ Error writing data store:', err.message);
        return false;
    }
}

function addVideo(videoId, videoData) {
    const store = readStore();
    store.videos[videoId] = {
        ...videoData,
        createdAt: new Date().toISOString()
    };
    store.stats.totalVideos = Object.keys(store.videos).length;
    return writeStore(store);
}

function getVideo(videoId) {
    const store = readStore();
    return store.videos[videoId] || null;
}

function getAllVideos() {
    const store = readStore();
    return store.videos;
}

function recordUser(userId, username) {
    const store = readStore();
    const now = new Date().toISOString();
    if (!store.users[userId]) {
        store.users[userId] = {
            username: username || '',
            firstSeen: now,
            lastActive: now,
            streak: 0,
            deliveries: 0
        };
        store.stats.totalUsers = Object.keys(store.users).length;
    } else {
        store.users[userId].lastActive = now;
    }
    return writeStore(store);
}

function recordDelivery(userId) {
    const store = readStore();
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (store.users[userId]) {
        const lastActiveDate = store.users[userId].lastActive ? store.users[userId].lastActive.split('T')[0] : '';

        if (lastActiveDate !== today) {
            // Check if streak continues
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (lastActiveDate === yesterdayStr) {
                store.users[userId].streak = (store.users[userId].streak || 0) + 1;
            } else {
                store.users[userId].streak = 1;
            }
        }

        store.users[userId].deliveries = (store.users[userId].deliveries || 0) + 1;
        store.users[userId].lastActive = now.toISOString();
    }
    store.stats.totalDeliveries = (store.stats.totalDeliveries || 0) + 1;
    return writeStore(store);
}

function getStats() {
    const store = readStore();
    return store.stats;
}

module.exports = {
    readStore,
    writeStore,
    addVideo,
    getVideo,
    getAllVideos,
    recordUser,
    recordDelivery,
    getStats
};