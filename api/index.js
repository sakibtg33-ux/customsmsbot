const { Telegraf } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

// ================== কনফিগ ==================
const BOT_TOKEN = "8896805760:AAGt4CDbEdGP_Xedc9p_SpFu4d7rA3QOOSE";
const ADMIN_USER_ID = 1700797877; // ← আপনার আইডি দিন
const DEFAULT_API_KEY = "di80n58vVw6UDgQfH0bxtl3N3dR1i4yA6pfhPXEz";
const API_URL = "https://api.sms.net.bd/sendsms";
// =========================================

const DB_PATH = "/tmp/sms.db";

// ---------- ডেটাবেস ----------
let db = null;

async function getDB() {
    if (!db) {
        // ডিরেক্টরি তৈরি
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                daily_limit INTEGER DEFAULT 5,
                today_count INTEGER DEFAULT 0,
                last_reset DATE
            );
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            INSERT OR IGNORE INTO config (key, value) VALUES ('api_key', '${DEFAULT_API_KEY}');
        `);
    }
    return db;
}

async function getUser(user_id) {
    const db = await getDB();
    const today = new Date().toISOString().split('T')[0];
    let row = await db.get('SELECT daily_limit, today_count, last_reset FROM users WHERE user_id = ?', user_id);
    if (row) {
        if (row.last_reset !== today) {
            row.today_count = 0;
            await db.run('UPDATE users SET today_count = 0, last_reset = ? WHERE user_id = ?', today, user_id);
        }
        return { daily_limit: row.daily_limit, today_count: row.today_count };
    } else {
        await db.run('INSERT INTO users (user_id, daily_limit, today_count, last_reset) VALUES (?, 5, 0, ?)', user_id, today);
        return { daily_limit: 5, today_count: 0 };
    }
}

async function incrementCount(user_id) {
    const db = await getDB();
    const today = new Date().toISOString().split('T')[0];
    await db.run('UPDATE users SET today_count = today_count + 1, last_reset = ? WHERE user_id = ?', today, user_id);
}

async function getApiKey() {
    const db = await getDB();
    const row = await db.get('SELECT value FROM config WHERE key = "api_key"');
    return row ? row.value : null;
}

async function setApiKey(key) {
    const db = await getDB();
    await db.run('UPDATE config SET value = ? WHERE key = "api_key"', key);
}

async function setDailyLimitForAll(limit) {
    const db = await getDB();
    await db.run('UPDATE users SET daily_limit = ?', limit);
}

async function getAllUsers() {
    const db = await getDB();
    return await db.all('SELECT user_id, daily_limit, today_count, last_reset FROM users');
}

// ---------- বট ----------
const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    await getUser(userId);
    await ctx.reply(
        "🤖 *SMS বটে স্বাগতম!*\n\n" +
        "📌 `/send 017XXXXXXXX বার্তা` – SMS পাঠান\n" +
        "📊 `/status` – আজকের বাকি SMS সংখ্যা\n" +
        "👨‍💼 অ্যাডমিন: `/admin`\n\n" +
        "প্রতিদিন ডিফল্ট ৫টি SMS পাঠাতে পারবেন।",
        { parse_mode: "Markdown" }
    );
});

bot.command('send', async (ctx) => {
    const userId = ctx.from.id;
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
        await ctx.reply("⚠️ সঠিক ফরম্যাট: `/send 017XXXXXXXX বার্তা`");
        return;
    }
    const phone = args[1];
    const message = args.slice(2).join(' ');

    const userData = await getUser(userId);
    const limit = userData.daily_limit;
    const used = userData.today_count;
    const remaining = limit - used;
    if (remaining <= 0) {
        await ctx.reply(`⛔ আপনি আজকের ${limit}টি SMS শেষ করে ফেলেছেন। আগামীকাল চেষ্টা করুন।`);
        return;
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
        await ctx.reply("❌ API key কনফিগার করা নেই। অ্যাডমিনকে জানান।");
        return;
    }

    const cleanPhone = phone.replace(/^0+/, '');
    if (cleanPhone.length !== 10) {
        await ctx.reply("❌ ফোন নম্বর ১০ ডিজিটের হতে হবে (০ ছাড়া)");
        return;
    }

    const url = `${API_URL}?api_key=${apiKey}&msg=${encodeURIComponent(message)}&to=880${cleanPhone}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.error === 0) {
            await incrementCount(userId);
            await ctx.reply(
                `✅ সফল! Request ID: ${data.data?.request_id || 'N/A'}\n\n📊 আজ বাকি: ${remaining - 1}টি`
            );
        } else {
            await ctx.reply(`❌ ব্যর্থ: ${data.msg || 'অজানা ত্রুটি'}`);
        }
    } catch (err) {
        await ctx.reply(`❌ নেটওয়ার্ক ত্রুটি: ${err.message}`);
    }
});

bot.command('status', async (ctx) => {
    const userId = ctx.from.id;
    const userData = await getUser(userId);
    const remaining = userData.daily_limit - userData.today_count;
    await ctx.reply(
        `📊 *আজকের SMS স্ট্যাটাস*\n` +
        `📤 দৈনিক সীমা: ${userData.daily_limit}\n` +
        `📨 আজকে পাঠিয়েছেন: ${userData.today_count}\n` +
        `✅ বাকি: ${remaining}`,
        { parse_mode: "Markdown" }
    );
});

bot.command('admin', async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_USER_ID) {
        await ctx.reply("⛔ এই কমান্ড শুধু অ্যাডমিনের জন্য।");
        return;
    }
    const apiKey = await getApiKey();
    await ctx.reply(
        "👨‍💼 *অ্যাডমিন প্যানেল*\n\n" +
        "🔑 `/setapikey YOUR_API_KEY` – API key পরিবর্তন করুন\n" +
        "🔢 `/setlimit 10` – সব ইউজারের দৈনিক সীমা পরিবর্তন\n" +
        "📊 `/users` – সব ইউজারের তালিকা\n" +
        `📌 বর্তমান API key: \`${apiKey ? apiKey.substring(0,10) + '...' : 'সেট নেই'}\``,
        { parse_mode: "Markdown" }
    );
});

bot.command('setapikey', async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_USER_ID) {
        await ctx.reply("⛔ অ্যাডমিন অনুমতি নেই।");
        return;
    }
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        await ctx.reply("⚠️ `/setapikey YOUR_API_KEY`");
        return;
    }
    await setApiKey(args[1]);
    await ctx.reply("✅ API key সফলভাবে আপডেট করা হয়েছে।");
});

bot.command('setlimit', async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_USER_ID) {
        await ctx.reply("⛔ অ্যাডমিন অনুমতি নেই।");
        return;
    }
    const args = ctx.message.text.split(' ');
    if (args.length < 2 || !/^\d+$/.test(args[1])) {
        await ctx.reply("⚠️ `/setlimit 10` (সংখ্যা দিন)");
        return;
    }
    const newLimit = parseInt(args[1]);
    if (newLimit < 1) {
        await ctx.reply("সীমা কমপক্ষে ১ হতে হবে।");
        return;
    }
    await setDailyLimitForAll(newLimit);
    await ctx.reply(`✅ সব ইউজারের দৈনিক সীমা \`${newLimit}\` এ সেট করা হয়েছে।`, { parse_mode: "Markdown" });
});

bot.command('users', async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_USER_ID) {
        await ctx.reply("⛔ অ্যাডমিন অনুমতি নেই।");
        return;
    }
    const rows = await getAllUsers();
    if (!rows || rows.length === 0) {
        await ctx.reply("কোনো ইউজার নেই।");
        return;
    }
    let text = "👥 *ইউজার লিস্ট*\n\n";
    for (const row of rows) {
        text += `🆔 ${row.user_id}\n  সীমা: ${row.daily_limit}, আজকে: ${row.today_count}, শেষ রিসেট: ${row.last_reset}\n\n`;
    }
    await ctx.reply(text, { parse_mode: "Markdown" });
});

bot.on('text', async (ctx) => {
    await ctx.reply("🤔 অজানা কমান্ড। `/start` টাইপ করে সাহায্য নিন।");
});

// ---------- Webhook অটো সেট ----------
async function setWebhook() {
    const vercelUrl = "https://customsmsbot.vercel.app";
    const webhookUrl = `${vercelUrl}/api/index`;
    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
        const data = await response.json();
        if (data.ok) {
            console.log(`✅ Webhook সেট হয়েছে: ${webhookUrl}`);
        } else {
            console.error(`❌ Webhook সেট হয়নি: ${data}`);
        }
    } catch (err) {
        console.error(`❌ Webhook error: ${err.message}`);
    }
}

// ---------- Vercel entrypoint ----------
module.exports = async (req, res) => {
    try {
        // Webhook সেট (শুধু প্রথমবার)
        await setWebhook();
        
        // যদি GET রিকোয়েস্ট হয় (হেলথ চেক)
        if (req.method === 'GET') {
            return res.status(200).json({ status: 'ok', message: 'Bot is running' });
        }

        // POST রিকোয়েস্ট (Telegram webhook)
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body);
            return res.status(200).json({ status: 'ok' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
