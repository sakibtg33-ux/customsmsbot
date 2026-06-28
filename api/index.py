import json
import logging
import sqlite3
import datetime
import os
import requests
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

# ---------- লগ ----------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------- কনফিগ (সব ডেটা এখানে) ----------
BOT_TOKEN = "8896805760:AAGt4CDbEdGP_Xedc9p_SpFu4d7rA3QOOSE"
ADMIN_USER_ID = 1700797877   # ← আপনার আসল আইডি দিন (সংখ্যা)
DEFAULT_API_KEY = "di80n58vVw6UDgQfH0bxtl3N3dR1i4yA6pfhPXEz"
API_URL = "https://api.sms.net.bd/sendsms"

# ---------- ডেটাবেস ----------
DB_PATH = "/tmp/sms.db"

def get_db():
    return sqlite3.connect(DB_PATH)

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            daily_limit INTEGER DEFAULT 5,
            today_count INTEGER DEFAULT 0,
            last_reset DATE
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')
    c.execute('''
        INSERT OR IGNORE INTO config (key, value)
        VALUES ('api_key', ?)
    ''', (DEFAULT_API_KEY,))
    conn.commit()
    conn.close()

def get_user(user_id):
    init_db()
    conn = get_db()
    c = conn.cursor()
    today = datetime.date.today().isoformat()
    c.execute('SELECT daily_limit, today_count, last_reset FROM users WHERE user_id = ?', (user_id,))
    row = c.fetchone()
    if row:
        daily_limit, today_count, last_reset = row
        if last_reset != today:
            today_count = 0
            c.execute('UPDATE users SET today_count = 0, last_reset = ? WHERE user_id = ?', (today, user_id))
            conn.commit()
        conn.close()
        return {'daily_limit': daily_limit, 'today_count': today_count}
    else:
        c.execute('INSERT INTO users (user_id, daily_limit, today_count, last_reset) VALUES (?, 5, 0, ?)',
                  (user_id, today))
        conn.commit()
        conn.close()
        return {'daily_limit': 5, 'today_count': 0}

def increment_count(user_id):
    conn = get_db()
    c = conn.cursor()
    today = datetime.date.today().isoformat()
    c.execute('UPDATE users SET today_count = today_count + 1, last_reset = ? WHERE user_id = ?', (today, user_id))
    conn.commit()
    conn.close()

def set_daily_limit_for_all(limit):
    conn = get_db()
    c = conn.cursor()
    c.execute('UPDATE users SET daily_limit = ?', (limit,))
    conn.commit()
    conn.close()

def get_api_key():
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT value FROM config WHERE key = "api_key"')
    row = c.fetchone()
    conn.close()
    return row[0] if row else None

def set_api_key(new_key):
    conn = get_db()
    c = conn.cursor()
    c.execute('UPDATE config SET value = ? WHERE key = "api_key"', (new_key,))
    conn.commit()
    conn.close()

def get_all_users():
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT user_id, daily_limit, today_count, last_reset FROM users')
    rows = c.fetchall()
    conn.close()
    return rows

# ---------- বট কমান্ড ----------
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    get_user(user_id)
    await update.message.reply_text(
        "🤖 *SMS বটে স্বাগতম!*\n\n"
        "📌 `/send 017XXXXXXXX বার্তা` – SMS পাঠান\n"
        "📊 `/status` – আজকের বাকি SMS সংখ্যা\n"
        "👨‍💼 অ্যাডমিন: `/admin`\n\n"
        "প্রতিদিন ডিফল্ট ৫টি SMS পাঠাতে পারবেন।",
        parse_mode="Markdown"
    )

async def send_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    args = context.args
    if len(args) < 2:
        await update.message.reply_text("⚠️ সঠিক ফরম্যাট: `/send 017XXXXXXXX বার্তা`")
        return
    phone = args[0]
    message = ' '.join(args[1:])
    
    user_data = get_user(user_id)
    limit = user_data['daily_limit']
    used = user_data['today_count']
    remaining = limit - used
    if remaining <= 0:
        await update.message.reply_text(f"⛔ আপনি আজকের {limit}টি SMS শেষ করে ফেলেছেন। আগামীকাল চেষ্টা করুন।")
        return
    
    api_key = get_api_key()
    if not api_key:
        await update.message.reply_text("❌ API key কনফিগার করা নেই। অ্যাডমিনকে জানান।")
        return
    
    clean_phone = phone.lstrip('0')
    if len(clean_phone) != 10:
        await update.message.reply_text("❌ ফোন নম্বর ১০ ডিজিটের হতে হবে (০ ছাড়া)")
        return
    url = API_URL
    params = {'api_key': api_key, 'msg': message, 'to': '880' + clean_phone}
    try:
        resp = requests.get(url, params=params, timeout=10)
        data = resp.json()
        if data.get('error') == 0:
            increment_count(user_id)
            remaining -= 1
            await update.message.reply_text(
                f"✅ সফল! Request ID: {data.get('data', {}).get('request_id', 'N/A')}\n\n📊 আজ বাকি: {remaining}টি"
            )
        else:
            await update.message.reply_text(f"❌ ব্যর্থ: {data.get('msg', 'অজানা ত্রুটি')}")
    except Exception as e:
        await update.message.reply_text(f"❌ নেটওয়ার্ক ত্রুটি: {str(e)}")

async def status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    user_data = get_user(user_id)
    limit = user_data['daily_limit']
    used = user_data['today_count']
    remaining = limit - used
    await update.message.reply_text(
        f"📊 *আজকের SMS স্ট্যাটাস*\n"
        f"📤 দৈনিক সীমা: {limit}\n"
        f"📨 আজকে পাঠিয়েছেন: {used}\n"
        f"✅ বাকি: {remaining}",
        parse_mode="Markdown"
    )

async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id != ADMIN_USER_ID:
        await update.message.reply_text("⛔ এই কমান্ড শুধু অ্যাডমিনের জন্য।")
        return
    api_key = get_api_key()
    await update.message.reply_text(
        "👨‍💼 *অ্যাডমিন প্যানেল*\n\n"
        "🔑 `/setapikey YOUR_API_KEY` – API key পরিবর্তন করুন\n"
        "🔢 `/setlimit 10` – সব ইউজারের দৈনিক সীমা পরিবর্তন\n"
        "📊 `/users` – সব ইউজারের তালিকা\n"
        f"📌 বর্তমান API key: `{api_key[:10]}...`" if api_key else "📌 API key সেট নেই",
        parse_mode="Markdown"
    )

async def set_apikey(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id != ADMIN_USER_ID:
        await update.message.reply_text("⛔ অ্যাডমিন অনুমতি নেই।")
        return
    args = context.args
    if not args:
        await update.message.reply_text("⚠️ `/setapikey YOUR_API_KEY`")
        return
    set_api_key(args[0])
    await update.message.reply_text("✅ API key সফলভাবে আপডেট করা হয়েছে।")

async def set_limit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id != ADMIN_USER_ID:
        await update.message.reply_text("⛔ অ্যাডমিন অনুমতি নেই।")
        return
    args = context.args
    if not args or not args[0].isdigit():
        await update.message.reply_text("⚠️ `/setlimit 10` (সংখ্যা দিন)")
        return
    new_limit = int(args[0])
    if new_limit < 1:
        await update.message.reply_text("সীমা কমপক্ষে ১ হতে হবে।")
        return
    set_daily_limit_for_all(new_limit)
    await update.message.reply_text(f"✅ সব ইউজারের দৈনিক সীমা `{new_limit}` এ সেট করা হয়েছে।")

async def users_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id != ADMIN_USER_ID:
        await update.message.reply_text("⛔ অ্যাডমিন অনুমতি নেই।")
        return
    rows = get_all_users()
    if not rows:
        await update.message.reply_text("কোনো ইউজার নেই।")
        return
    text = "👥 *ইউজার লিস্ট*\n\n"
    for row in rows:
        text += f"🆔 {row[0]}\n  সীমা: {row[1]}, আজকে: {row[2]}, শেষ রিসেট: {row[3]}\n\n"
        if len(text) > 4000:
            await update.message.reply_text(text, parse_mode="Markdown")
            text = ""
    if text:
        await update.message.reply_text(text, parse_mode="Markdown")

async def unknown(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🤔 অজানা কমান্ড। `/start` টাইপ করে সাহায্য নিন।")

# ---------- বট অ্যাপ্লিকেশন ----------
_bot_app = None

def get_bot_app():
    global _bot_app
    if _bot_app is None:
        app = Application.builder().token(BOT_TOKEN).build()
        app.add_handler(CommandHandler("start", start))
        app.add_handler(CommandHandler("send", send_command))
        app.add_handler(CommandHandler("status", status))
        app.add_handler(CommandHandler("admin", admin_panel))
        app.add_handler(CommandHandler("setapikey", set_apikey))
        app.add_handler(CommandHandler("setlimit", set_limit))
        app.add_handler(CommandHandler("users", users_list))
        app.add_handler(MessageHandler(filters.COMMAND, unknown))
        _bot_app = app
    return _bot_app

# ---------- Webhook ----------
_webhook_set = False

def set_webhook():
    global _webhook_set
    if _webhook_set:
        return
    vercel_url = "https://customsmsbot.vercel.app"
    webhook_url = f"{vercel_url}/api/index"
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/setWebhook"
    params = {"url": webhook_url}
    try:
        resp = requests.get(url, params=params, timeout=5)
        data = resp.json()
        if data.get("ok"):
            logger.info(f"✅ Webhook সেট হয়েছে: {webhook_url}")
        else:
            logger.error(f"❌ Webhook সেট হয়নি: {data}")
    except Exception as e:
        logger.error(f"❌ Webhook error: {e}")
    _webhook_set = True

# ---------- Vercel entrypoint ----------
async def handler(request):
    try:
        set_webhook()
        body = await request.body()
        data = json.loads(body)
        update = Update.de_json(data, None)
        if update is None:
            return {"statusCode": 400, "body": json.dumps({"error": "Invalid update"})}
        app = get_bot_app()
        await app.process_update(update)
        return {"statusCode": 200, "body": json.dumps({"status": "ok"})}
    except Exception as e:
        logger.error(f"Handler error: {e}", exc_info=True)
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
