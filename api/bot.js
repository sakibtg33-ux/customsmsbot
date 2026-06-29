require('dotenv').config();
const { Telegraf } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ================== CONFIG ==================
const BOT_TOKEN = process.env.BOT_TOKEN || '8896805760:AAGt4CDbEdGP_Xedc9p_SpFu4d7rA3QOOSE';
const ADMIN_USER_ID = parseInt(process.env.ADMIN_USER_ID) || 1700797877;
const DEFAULT_API_KEY = process.env.DEFAULT_API_KEY || 'di80n58vVw6UDgQfH0bxtl3N3dR1i4yA6pfhPXEz';
const SMS_API_URL = 'https://api.sms.net.bd/sendsms';
const BALANCE_API_URL = 'https://api.sms.net.bd/user/balance/';
// =============================================

// ---------- Database (persistent file) ----------
const DB_PATH = path.join(__dirname, 'sms.db');

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
  db.run(`
    INSERT OR IGNORE INTO config (key, value)
    VALUES ('default_limit', '5')
  `);
  db.close();
  console.log('✅ Database initialized at:', DB_PATH);
}

// ---------- Database Helpers ----------
function getDefaultLimit() {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.get('SELECT value FROM config WHERE key = "default_limit"', (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row ? parseInt(row.value) : 5);
    });
  });
}

function setDefaultLimit(limit) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.run('UPDATE config SET value = ? WHERE key = "default_limit"', [String(limit)], (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

function getUser(user_id) {
  return new Promise(async (resolve, reject) => {
    const db = getDB();
    const today = new Date().toISOString().split('T')[0];
    db.get('SELECT daily_limit, today_count, last_reset FROM users WHERE user_id = ?', [user_id], async (err, row) => {
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
        try {
          const defaultLimit = await getDefaultLimit();
          db.run('INSERT INTO users (user_id, daily_limit, today_count, last_reset) VALUES (?, ?, 0, ?)',
            [user_id, defaultLimit, today], (err) => {
              db.close();
              if (err) reject(err);
              else resolve({ daily_limit: defaultLimit, today_count: 0 });
            });
        } catch (err) {
          db.close();
          reject(err);
        }
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
  return new Promise(async (resolve, reject) => {
    try {
      const db = getDB();
      db.run('UPDATE users SET daily_limit = ?', [limit], function(err) {
        if (err) { db.close(); reject(err); return; }
        const updatedCount = this.changes;
        db.run('UPDATE config SET value = ? WHERE key = "default_limit"', [String(limit)], (err2) => {
          db.close();
          if (err2) reject(err2);
          else resolve(updatedCount);
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

function setUserLimit(user_id, limit) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    db.run('UPDATE users SET daily_limit = ? WHERE user_id = ?', [limit, user_id], function(err) {
      db.close();
      if (err) reject(err);
      else resolve(this.changes);
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

// ---------- SMS Sender ----------
async function sendSMS(apiKey, phone, message) {
  const cleanPhone = phone.replace(/^0+/, '');
  if (cleanPhone.length !== 10) {
    return { success: false, msg: 'Phone number must be 10 digits (without leading 0).' };
  }
  const url = `${SMS_API_URL}?api_key=${apiKey}&msg=${encodeURIComponent(message)}&to=880${cleanPhone}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.error === 0) {
      return { success: true, msg: `✅ Success! Request ID: ${data.data?.request_id || 'N/A'}` };
    } else {
      return { success: false, msg: `❌ Failed: ${data.msg || 'Unknown error'}` };
    }
  } catch (error) {
    return { success: false, msg: `❌ Network error: ${error.message}` };
  }
}

// ---------- Balance Check ----------
async function checkBalance(apiKey) {
  try {
    const url = `${BALANCE_API_URL}?api_key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.error === 0) {
      const balance = data.balance || data.data?.balance || 'N/A';
      return { success: true, balance };
    } else {
      return { success: false, msg: data.msg || 'Failed to fetch balance' };
    }
  } catch (error) {
    return { success: false, msg: `Network error: ${error.message}` };
  }
}

// ---------- Bot ----------
const bot = new Telegraf(BOT_TOKEN);

// ---------- Commands ----------

// /start
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const userData = await getUser(userId);
  const isAdmin = (userId === ADMIN_USER_ID);

  let msg = '🤖 *Welcome to SMS Bot!*\n\n';
  msg += '📌 `/send 017XXXXXXXX message` – Send SMS\n';
  msg += '📊 `/status` – Check your remaining SMS today\n';
  if (isAdmin) {
    msg += '👨‍💼 `/admin` – Admin panel\n';
  }
  msg += `\n📤 Your daily limit: ${userData.daily_limit} SMS`;
  if (isAdmin) {
    msg += ' (Admin: Unlimited)';
  }
  await ctx.replyWithMarkdown(msg);
});

// /send
bot.command('send', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  if (args.length < 3) {
    await ctx.reply('⚠️ Correct format: `/send 017XXXXXXXX message`');
    return;
  }
  const phone = args[1];
  const message = args.slice(2).join(' ');

  const userData = await getUser(userId);
  const isAdmin = (userId === ADMIN_USER_ID);

  if (!isAdmin) {
    const limit = userData.daily_limit;
    const used = userData.today_count;
    const remaining = limit - used;
    if (remaining <= 0) {
      await ctx.reply(`⛔ You have reached your daily limit of ${limit} SMS. Try again tomorrow.`);
      return;
    }
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    await ctx.reply('❌ API key not configured. Contact admin.');
    return;
  }

  const result = await sendSMS(apiKey, phone, message);
  if (result.success) {
    if (!isAdmin) {
      await incrementCount(userId);
      const updated = await getUser(userId);
      const remaining = updated.daily_limit - updated.today_count;
      await ctx.reply(`${result.msg}\n\n📊 Remaining today: ${remaining}`);
    } else {
      await ctx.reply(`${result.msg}\n\n👑 Admin: Unlimited`);
    }
  } else {
    await ctx.reply(result.msg);
  }
});

// /status
bot.command('status', async (ctx) => {
  const userId = ctx.from.id;
  const userData = await getUser(userId);
  const limit = userData.daily_limit;
  const used = userData.today_count;
  const remaining = limit - used;
  const isAdmin = (userId === ADMIN_USER_ID);

  let text = `📊 *Today's SMS Status*\n`;
  if (isAdmin) {
    text += `👑 Admin: Unlimited\n`;
  } else {
    text += `📤 Daily limit: ${limit}\n📨 Sent today: ${used}\n✅ Remaining: ${remaining}`;
  }
  await ctx.replyWithMarkdown(text);
});

// /admin
bot.command('admin', async (ctx) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('⛔ Admin only command.');
    return;
  }
  const apiKey = await getApiKey();
  const defaultLimit = await getDefaultLimit();
  await ctx.replyWithMarkdown(
    '👨‍💼 *Admin Panel*\n\n' +
    '🔑 `/setapikey YOUR_API_KEY` – Update API key\n' +
    `🔢 \`/setlimit ${defaultLimit}\` – Set daily limit for *ALL* users (existing + new)\n` +
    '👤 `/setuserlimit USER_ID LIMIT` – Set limit for a *specific* user\n' +
    '🔍 `/checklimit USER_ID` – Check a user\'s current limit\n' +
    '📊 `/users` – List all users\n' +
    '💰 `/balance` – Check SMS balance\n' +
    `📌 Current API key: \`${apiKey ? apiKey.substring(0, 10) + '...' : 'Not set'}\``
  );
});

// /setapikey
bot.command('setapikey', async (ctx) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('⛔ Admin only.');
    return;
  }
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    await ctx.reply('⚠️ `/setapikey YOUR_API_KEY`');
    return;
  }
  await setApiKey(args[1]);
  await ctx.reply('✅ API key updated successfully.');
});

// /setlimit (global)
bot.command('setlimit', async (ctx) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('⛔ Admin only.');
    return;
  }
  const args = ctx.message.text.split(' ');
  if (args.length < 2 || isNaN(args[1])) {
    await ctx.reply('⚠️ `/setlimit 10` (enter a number)');
    return;
  }
  const newLimit = parseInt(args[1]);
  if (newLimit < 1) {
    await ctx.reply('Limit must be at least 1.');
    return;
  }
  try {
    const updatedRows = await setDailyLimitForAll(newLimit);
    await ctx.reply(
      `✅ Daily limit set to \`${newLimit}\` for *ALL* users.\n\n` +
      `📊 Updated ${updatedRows} existing users.\n` +
      `🆕 New users will also get this limit.\n` +
      `📌 Now everyone's daily limit is ${newLimit}.`
    );
  } catch (err) {
    console.error('setlimit error:', err);
    await ctx.reply(`❌ Failed to update limits: ${err.message}`);
  }
});

// /setuserlimit (individual)
bot.command('setuserlimit', async (ctx) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('⛔ Admin only.');
    return;
  }
  const args = ctx.message.text.split(' ');
  if (args.length < 3 || isNaN(args[1]) || isNaN(args[2])) {
    await ctx.reply('⚠️ `/setuserlimit USER_ID LIMIT` (both must be numbers)');
    return;
  }
  const targetUserId = parseInt(args[1]);
  const newLimit = parseInt(args[2]);
  if (newLimit < 1) {
    await ctx.reply('Limit must be at least 1.');
    return;
  }
  try {
    const changes = await setUserLimit(targetUserId, newLimit);
    if (changes === 0) {
      await ctx.reply(`❌ User ${targetUserId} not found.`);
    } else {
      await ctx.reply(`✅ Daily limit for user \`${targetUserId}\` set to \`${newLimit}\`.`);
    }
  } catch (err) {
    console.error('setuserlimit error:', err);
    await ctx.reply(`❌ Failed to update: ${err.message}`);
  }
});

// /checklimit (admin only)
bot.command('checklimit', async (ctx) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('⛔ Admin only.');
    return;
  }
  const args = ctx.message.text.split(' ');
  if (args.length < 2 || isNaN(args[1])) {
    await ctx.reply('⚠️ `/checklimit USER_ID`');
    return;
  }
  const targetUserId = parseInt(args[1]);
  try {
    const userData = await getUser(targetUserId);
    await ctx.replyWithMarkdown(
      `👤 *User ${targetUserId}*\n` +
      `📤 Daily limit: ${userData.daily_limit}\n` +
      `📨 Sent today: ${userData.today_count}`
    );
  } catch (err) {
    await ctx.reply(`❌ Error: ${err.message}`);
  }
});

// /users
bot.command('users', async (ctx) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('⛔ Admin only.');
    return;
  }
  const rows = await getAllUsers();
  if (!rows || rows.length === 0) {
    await ctx.reply('No users found.');
    return;
  }
  let text = '👥 *User List*\n\n';
  for (const row of rows) {
    text += `🆔 ${row.user_id}\n  Limit: ${row.daily_limit}, Today: ${row.today_count}, Reset: ${row.last_reset}\n\n`;
    if (text.length > 4000) {
      await ctx.replyWithMarkdown(text);
      text = '';
    }
  }
  if (text) await ctx.replyWithMarkdown(text);
});

// /balance
bot.command('balance', async (ctx) => {
  const userId = ctx.from.id;
  if (userId !== ADMIN_USER_ID) {
    await ctx.reply('⛔ Admin only command.');
    return;
  }
  const apiKey = await getApiKey();
  if (!apiKey) {
    await ctx.reply('❌ API key not configured. Use /setapikey first.');
    return;
  }
  const result = await checkBalance(apiKey);
  if (result.success) {
    await ctx.reply(`💰 *SMS Balance*\n\nBalance: \`${result.balance}\` SMS`, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(`❌ Failed to fetch balance: ${result.msg}`);
  }
});

// Unknown command
bot.on('text', async (ctx) => {
  await ctx.reply('🤔 Unknown command. Type `/start` for help.');
});

// ---------- Start bot with polling ----------
initDB();

bot.launch()
  .then(() => {
    console.log('🤖 Bot started successfully with polling!');
    console.log(`📊 Admin ID: ${ADMIN_USER_ID}`);
    console.log(`📁 Database: ${DB_PATH}`);
  })
  .catch(err => {
    console.error('❌ Failed to start bot:', err);
  });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
