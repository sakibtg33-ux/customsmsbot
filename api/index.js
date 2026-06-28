const { Telegraf } = require('telegraf');
const axios = require('axios');

// ============= কনফিগ (আপনার ডেটা) =============
const BOT_TOKEN = "8896805760:AAGt4CDbEdGP_Xedc9p_SpFu4d7rA3QOOSE";
const ADMIN_USER_ID = 1700797877; // ← আপনার আসল টেলিগ্রাম ইউজার আইডি (সংখ্যা) দিন
const DEFAULT_API_KEY = "di80n58vVw6UDgQfH0bxtl3N3dR1i4yA6pfhPXEz";
const API_URL = "https://api.sms.net.bd/sendsms";
// ===============================================

// ডেটাবেস (মেমোরি – Vercel-এ persist করবে না, টেস্টিংয়ের জন্য)
// প্রোডাকশনে Vercel KV বা Supabase ব্যবহার করুন
const users = new Map(); // user_id -> { dailyLimit, todayCount, lastReset }

function getUser(userId) {
  const today = new Date().toISOString().split('T')[0];
  if (!users.has(userId)) {
    users.set(userId, { dailyLimit: 5, todayCount: 0, lastReset: today });
    return { dailyLimit: 5, todayCount: 0 };
  }
  const data = users.get(userId);
  if (data.lastReset !== today) {
    data.todayCount = 0;
    data.lastReset = today;
    users.set(userId, data);
  }
  return data;
}

function incrementCount(userId) {
  const data = users.get(userId);
  if (data) {
    data.todayCount += 1;
    users.set(userId, data);
  }
}

function setDailyLimitForAll(limit) {
  for (let [key, value] of users) {
    value.dailyLimit = limit;
    users.set(key, value);
  }
}

// বট অ্যাপ্লিকেশন তৈরি (একবার)
let bot = null;

function getBot() {
  if (!bot) {
    bot = new Telegraf(BOT_TOKEN);

    // ---------- কমান্ড ----------
    bot.start(async (ctx) => {
      const userId = ctx.from.id;
      getUser(userId);
      await ctx.replyWithMarkdown(
        "🤖 *SMS বটে স্বাগতম!*\n\n" +
        "📌 `/send 017XXXXXXXX বার্তা` – SMS পাঠান\n" +
        "📊 `/status` – আজকের বাকি SMS সংখ্যা\n" +
        "👨‍💼 অ্যাডমিন: `/admin`\n\n" +
        "প্রতিদিন ডিফল্ট ৫টি SMS পাঠাতে পারবেন।"
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

      const userData = getUser(userId);
      const limit = userData.dailyLimit;
      const used = userData.todayCount;
      const remaining = limit - used;

      if (remaining <= 0) {
        await ctx.reply(`⛔ আপনি আজকের ${limit}টি SMS শেষ করে ফেলেছেন। আগামীকাল চেষ্টা করুন।`);
        return;
      }

      const cleanPhone = phone.replace(/^0+/, '');
      if (!/^[0-9]{10}$/.test(cleanPhone)) {
        await ctx.reply("❌ ফোন নম্বর ১০ ডিজিটের হতে হবে (০ ছাড়া)");
        return;
      }

      try {
        const params = {
          api_key: DEFAULT_API_KEY,
          msg: message,
          to: '880' + cleanPhone
        };
        const response = await axios.get(API_URL, { params, timeout: 10000 });
        const data = response.data;
        if (data.error === 0) {
          incrementCount(userId);
          const newRemaining = remaining - 1;
          await ctx.reply(
            `✅ সফল! Request ID: ${data.data?.request_id || 'N/A'}\n\n📊 আজ বাকি: ${newRemaining}টি`
          );
        } else {
          await ctx.reply(`❌ ব্যর্থ: ${data.msg || 'অজানা ত্রুটি'}`);
        }
      } catch (error) {
        await ctx.reply(`❌ নেটওয়ার্ক ত্রুটি: ${error.message}`);
      }
    });

    bot.command('status', async (ctx) => {
      const userId = ctx.from.id;
      const userData = getUser(userId);
      const limit = userData.dailyLimit;
      const used = userData.todayCount;
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
        await ctx.reply("⛔ এই কমান্ড শুধু অ্যাডমিনের জন্য।");
        return;
      }
      await ctx.replyWithMarkdown(
        "👨‍💼 *অ্যাডমিন প্যানেল*\n\n" +
        "🔑 `/setapikey YOUR_API_KEY` – API key পরিবর্তন করুন\n" +
        "🔢 `/setlimit 10` – সব ইউজারের দৈনিক সীমা পরিবর্তন\n" +
        "📊 `/users` – সব ইউজারের তালিকা\n" +
        `📌 বর্তমান API key: \`${DEFAULT_API_KEY.slice(0,10)}...\``
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
      // এখানে আপনি যদি চান DB-তে key সংরক্ষণ করতে পারেন, কিন্তু মেমোরিতে রাখছি
      // (কারণ Vercel serverless-এ মেমোরি persist করে না)
      // টেস্টিংয়ের জন্য শুধু কনফিগ আপডেট করছি
      // আপনাকে চাইলে Vercel KV বা Supabase ব্যবহার করতে হবে।
      await ctx.reply("✅ API key আপডেটের জন্য স্থায়ী ডেটাবেস প্রয়োজন। Vercel KV বা Supabase ব্যবহার করুন।");
    });

    bot.command('setlimit', async (ctx) => {
      const userId = ctx.from.id;
      if (userId !== ADMIN_USER_ID) {
        await ctx.reply("⛔ অ্যাডমিন অনুমতি নেই।");
        return;
      }
      const args = ctx.message.text.split(' ');
      if (args.length < 2 || isNaN(args[1])) {
        await ctx.reply("⚠️ `/setlimit 10` (সংখ্যা দিন)");
        return;
      }
      const newLimit = parseInt(args[1]);
      if (newLimit < 1) {
        await ctx.reply("সীমা কমপক্ষে ১ হতে হবে।");
        return;
      }
      setDailyLimitForAll(newLimit);
      await ctx.reply(`✅ সব ইউজারের দৈনিক সীমা \`${newLimit}\` এ সেট করা হয়েছে।`);
    });

    bot.command('users', async (ctx) => {
      const userId = ctx.from.id;
      if (userId !== ADMIN_USER_ID) {
        await ctx.reply("⛔ অ্যাডমিন অনুমতি নেই।");
        return;
      }
      if (users.size === 0) {
        await ctx.reply("কোনো ইউজার নেই।");
        return;
      }
      let text = "👥 *ইউজার লিস্ট*\n\n";
      for (let [id, data] of users) {
        text += `🆔 ${id}\n  সীমা: ${data.dailyLimit}, আজকে: ${data.todayCount}, শেষ রিসেট: ${data.lastReset}\n\n`;
        if (text.length > 4000) {
          await ctx.replyWithMarkdown(text);
          text = "";
        }
      }
      if (text) {
        await ctx.replyWithMarkdown(text);
      }
    });

    bot.on('text', async (ctx) => {
      await ctx.reply("🤔 অজানা কমান্ড। `/start` টাইপ করে সাহায্য নিন।");
    });
  }
  return bot;
}

// ---------- Webhook অটো সেট ----------
let webhookSet = false;

async function setWebhook() {
  if (webhookSet) return;
  const vercelUrl = "https://customsmsbot-4mqx.vercel.app";
  const webhookUrl = `${vercelUrl}/api/index`;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
  try {
    const response = await axios.get(url, { timeout: 5000 });
    if (response.data.ok) {
      console.log(`✅ Webhook সেট হয়েছে: ${webhookUrl}`);
    } else {
      console.error(`❌ Webhook সেট হয়নি: ${response.data}`);
    }
  } catch (error) {
    console.error(`❌ Webhook error: ${error.message}`);
  }
  webhookSet = true;
}

// ---------- Vercel entrypoint ----------
module.exports = async (req, res) => {
  try {
    // Webhook সেট (শুধু প্রথমবার)
    await setWebhook();

    // Telegram webhook থেকে ডেটা
    const bot = getBot();
    await bot.handleUpdate(req.body, res);

    // Respond to Telegram webhook
    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("Handler error:", error);
    res.status(500).json({ error: error.message });
  }
};
