const { Telegraf } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// ================== কনফিগ (আপনার ডেটা) ==================
const BOT_TOKEN = '8896805760:AAGt4CDbEdGP_Xedc9p_SpFu4d7rA3QOOSE';
const ADMIN_USER_ID = 123456789;  // ← আপনার আসল টেলিগ্রাম ইউজার আইডি (সংখ্যা)
const DEFAULT_API_KEY = 'di80n58vVw6UDgQfH0bxtl3N3dR1i4yA6pfhPXEz';
const API_URL = 'https://api.sms.net.bd/sendsms';
// ==========================================================

// ---------- ডেটাবেস (Vercel-এর /tmp তে) ----------
const DB_PATH = '/tmp/sms.db';

function getDB() {
  return new sqlite3.Database(DB_PATH);
}

function initDB() {
  const db = getDB();
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      daily_limit INTEGER DEFAULT 5,
      today_count INTEGER DEFAULT 0,
      last_reset DATE
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  db.run(`
    INSERT OR IGNORE INTO config (key, value)
    VALUES ('api_key', ?)
  `, [DEFAULT_API_KEY]);
  db.close();
}

function getUser(user_id) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    const today = new Date().toISOString().split('T')[0];
    db.get('SELECT daily_limit, today_count, last_reset FROM users WHERE user_id = ?', [user_id], (err, row) => {
      if (err) { db.close(); reject(err); return; }
      if (row) {
        let { daily_limit, today_count, last_reset } = row;
        if (last_reset !== today) {
          today_count = 0;
          db.run('UPDATE users SET today_count = 0, last_reset = ? WHERE user_id = ?', [today, user_id]);
        }
        db.close();
        resolve({ daily_limit, today_count });
      } else {
        db.run('INSERT INTO users (user_id, daily_limit, today_count, last_reset) VALUES (?, 5, 0, ?)',
          [user_id, today], (err) => {
            db.close();
            if (err) reject(err);
            else resolve({ daily_limit: 5, today_count: 0 });
          });
      }
    });
  });
}

function incrementCount(user_id) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    const today = new Date().toISOString().split('T')[0];
    db.run('UPDATE users SET today_count = today_count + 1, last_reset = ? WHERE user_id = ?', [today, user_id], (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

function setDailyLimitForAll(limit) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.run('UPDATE users SET daily_limit = ?', [limit], (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

function getApiKey() {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.get('SELECT value FROM config WHERE key = "api_key"', (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row ? row.value : null);
    });
  });
}

function setApiKey(newKey) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.run('UPDATE config SET value = ? WHERE key = "api_key"', [newKey], (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

function getAllUsers() {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.all('SELECT user_id, daily_limit, today_count, last_reset FROM users', (err, rows) => {
      db.close();
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ---------- SMS পাঠান ----------
async function sendSMS(apiKey, phone, message) {
  const cleanPhone = phone.replace(/^0+/, '');
  if (cleanPhone.length !== 10) {
    return { success: false, msg: 'ফোন নম্বর ১০ ডিজিটের হতে হবে (০ ছাড়া)' };
  }
  const url = `${API_URL}?api_key=${apiKey}&msg=${encodeURIComponent(message)}&to=880${cleanPhone}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.error === 0) {
      return { success: true, msg: `✅ সফল! Request ID: ${data.data?.request_id || 'N/A'}` };
    } else {
      return { success: false, msg: `❌ ব্যর্থ: ${data.msg || 'অজানা ত্রুটি'}` };
    }
  } catch (error) {
    return { success: false, msg: `❌ নেটওয়ার্ক ত্রুটি: ${error.message}` };
  }
}

// ---------- বট ----------
const bot = new Telegraf(BOT_TOKEN);

// Webhook সেট (অটো)
bot.telegram.setWebhook('https://customsmsbot-4mqx.vercel.app/api/index')
  .then(() => console.log('✅ Webhook সেট হয়েছে'))
  .catch(err => console.error('❌ Webhook error:', err));

// ----- কমান্ড -----
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  await getUser(userId);
  await ctx.replyWithMarkdown(
    '🤖 *SMS বটে স্বাগতম!*\n\n' +
    '📌 `/send 017XXXXXXXX বার্তা` – SMS পাঠান\n' +
    '📊 `/status` – আজকের বাকি SMS সংখ্যা\n' +
    '👨‍💼 অ্যাডমিন: `/admin`\n\n' +
    'প্রতিদিন ডিফল্ট ৫টি SMS পাঠাতে পারবেন।'
  );
});

bot.command('send', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  if (args.length < 3) {
    await ctx.reply('⚠️ সঠিক ফরম্যাট: `/send 017XXXXXXXX বার্তা`');
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
    await ctx.reply('❌ API key কনফিগার করা নেই। অ্যাডমিনকে জানান।');
    return;
  }

  const result = await sendSMS(apiKey, phone, message);
  if (result.success) {
    await incrementCount(userId);
    const newRemaining = remaining - 1;
    await ctx.reply(`${result.msg}\n\n📊 আজ বাকি: ${newRemaining}টি`);
  } else {
    await ctx.reply(result.msg);
  }
});

bot.command('status', async (ctx) => {
  const userId = ctx.from.id;
  const userData = await getUser(userId);
  const limit = userData.daily_limit;
  const used = userData.today_count;
  const remaining = limit - used;
  await ctx.replyWithMarkdown(
    `📊 *আজকের SMS স্ট্যাটাস*\n` +
    `📤 দৈনিক সীমা: ${limit}\n` +
    `📨 আজকে পাঠিয়েছেন: ${used}\n` +
    `✅ বাকি: ${remaining}`
  );
});

bot.command('admin', async (ctx) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('⛔ এই কমান্ড শুধু অ্যাডমিনের জন্য।');
    return;
  }
  const apiKey = await getApiKey();
  await ctx.replyWithMarkdown(
    '👨‍💼 *অ্যাডমিন প্যানেল*\n\n' +
    '🔑 `/setapikey YOUR_API_KEY` – API key পরিবর্তন করুন\n' +
    '🔢 `/setlimit 10` – সব ইউজারের দৈনিক সীমা পরিবর্তন\n' +
    '📊 `/users` – সব ইউজারের তালিকা\n' +
    `📌 বর্তমান API key: \`${apiKey ? apiKey.substring(0, 10) + '...' : 'সেট নেই'}\``
  );
});

bot.command('setapikey', async (ctx) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('⛔ অ্যাডমিন অনুমতি নেই।');
    return;
  }
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    await ctx.reply('⚠️ `/setapikey YOUR_API_KEY`');
    return;
  }
  await setApiKey(args[1]);
  await ctx.reply('✅ API key সফলভাবে আপডেট করা হয়েছে।');
});

bot.command('setlimit', async (ctx) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('⛔ অ্যাডমিন অনুমতি নেই।');
    return;
  }
  const args = ctx.message.text.split(' ');
  if (args.length < 2 || isNaN(args[1])) {
    await ctx.reply('⚠️ `/setlimit 10` (সংখ্যা দিন)');
    return;
  }
  const newLimit = parseInt(args[1]);
  if (newLimit < 1) {
    await ctx.reply('সীমা কমপক্ষে ১ হতে হবে।');
    return;
  }
  await setDailyLimitForAll(newLimit);
  await ctx.reply(`✅ সব ইউজারের দৈনিক সীমা \`${newLimit}\` এ সেট করা হয়েছে।`);
});

bot.command('users', async (ctx) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('⛔ অ্যাডমিন অনুমতি নেই।');
    return;
  }
  const rows = await getAllUsers();
  if (!rows || rows.length === 0) {
    await ctx.reply('কোনো ইউজার নেই।');
    return;
  }
  let text = '👥 *ইউজার লিস্ট*\n\n';
  for (const row of rows) {
    text += `🆔 ${row.user_id}\n  সীমা: ${row.daily_limit}, আজকে: ${row.today_count}, শেষ রিসেট: ${row.last_reset}\n\n`;
    if (text.length > 4000) {
      await ctx.replyWithMarkdown(text);
      text = '';
    }
  }
  if (text) await ctx.replyWithMarkdown(text);
});

bot.on('text', async (ctx) => {
  await ctx.reply('🤔 অজানা কমান্ড। `/start` টাইপ করে সাহায্য নিন।');
});

// ---------- Vercel handler ----------
initDB();

module.exports = async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};
