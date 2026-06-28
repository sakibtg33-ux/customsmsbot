import logging
import requests
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
import config
import database as db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ----- হেল্পার ফাংশন -----
def send_sms(api_key, phone, message):
    """sms.net.bd API তে কল করে"""
    # phone থেকে leading zero সরান
    clean_phone = phone.lstrip('0')
    if len(clean_phone) != 10:
        return False, "ফোন নম্বর ১০ ডিজিটের হতে হবে (০ ছাড়া)"
    
    url = config.API_URL
    params = {
        'api_key': api_key,
        'msg': message,
        'to': '880' + clean_phone
    }
    try:
        response = requests.get(url, params=params, timeout=10)
        data = response.json()
        if data.get('error') == 0:
            return True, f"✅ সফল! Request ID: {data.get('data', {}).get('request_id', 'N/A')}"
        else:
            return False, f"❌ ব্যর্থ: {data.get('msg', 'অজানা ত্রুটি')}"
    except Exception as e:
        return False, f"❌ নেটওয়ার্ক ত্রুটি: {str(e)}"

# ----- অ্যাডমিন চেক -----
def is_admin(user_id):
    return user_id == config.ADMIN_USER_ID

# ----- কমান্ড হ্যান্ডলার -----
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    db.get_user(user_id)  # ইউজার তৈরি/আপডেট
    await update.message.reply_text(
        "🤖 *SMS বটে স্বাগতম!*\n\n"
        "📌 `/send 017XXXXXXXX বার্তা` – SMS পাঠান\n"
        "📊 `/status` – আজকের বাকি SMS সংখ্যা\n"
        "👨‍💼 অ্যাডমিন কমান্ড: `/admin`\n\n"
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
    
    # ইউজার ডেটা
    user_data = db.get_user(user_id)
    limit = user_data['daily_limit']
    used = user_data['today_count']
    remaining = limit - used
    
    if remaining <= 0:
        await update.message.reply_text(f"⛔ আপনি আজকের {limit}টি SMS শেষ করে ফেলেছেন। আগামীকাল আবার চেষ্টা করুন।")
        return
    
    # API key নিন
    api_key = db.get_api_key()
    if not api_key:
        await update.message.reply_text("❌ API key কনফিগার করা নেই। অ্যাডমিনকে জানান।")
        return
    
    # SMS পাঠান
    success, msg = send_sms(api_key, phone, message)
    if success:
        db.increment_count(user_id)
        remaining -= 1
        await update.message.reply_text(
            f"{msg}\n\n📊 আজ বাকি: {remaining}টি"
        )
    else:
        await update.message.reply_text(msg)

async def status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    user_data = db.get_user(user_id)
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
    if not is_admin(user_id):
        await update.message.reply_text("⛔ এই কমান্ড শুধু অ্যাডমিনের জন্য।")
        return
    
    api_key = db.get_api_key()
    # প্রথম ইউজারকে উদাহরণ হিসেবে ধরি (আসলে সব ইউজারের সীমা দেখানো ভালো)
    # আমরা শুধু কমান্ড গাইড দেব
    await update.message.reply_text(
        "👨‍💼 *অ্যাডমিন প্যানেল*\n\n"
        "🔑 `/setapikey YOUR_API_KEY` – API key পরিবর্তন করুন\n"
        "🔢 `/setlimit 10` – সকল ইউজারের দৈনিক সীমা পরিবর্তন (ডিফল্ট ৫)\n"
        "📊 `/users` – সব ইউজারের তালিকা ও স্ট্যাটাস\n"
        f"📌 বর্তমান API key: `{api_key[:10]}...`" if api_key else "📌 API key সেট নেই",
        parse_mode="Markdown"
    )

async def set_apikey(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if not is_admin(user_id):
        await update.message.reply_text("⛔ অ্যাডমিন অনুমতি নেই।")
        return
    
    args = context.args
    if not args:
        await update.message.reply_text("⚠️ `/setapikey YOUR_API_KEY`")
        return
    
    new_key = args[0]
    db.set_api_key(new_key)
    await update.message.reply_text("✅ API key সফলভাবে আপডেট করা হয়েছে।")

async def set_limit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if not is_admin(user_id):
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
    
    # সব ইউজারের জন্য সীমা আপডেট (অথবা আমরা শুধু অ্যাডমিনের? আমরা সব ইউজারের জন্য করছি)
    conn = sqlite3.connect(db.DB_NAME)
    c = conn.cursor()
    c.execute('UPDATE users SET daily_limit = ?', (new_limit,))
    conn.commit()
    conn.close()
    await update.message.reply_text(f"✅ সব ইউজারের দৈনিক সীমা `{new_limit}` এ সেট করা হয়েছে।")

async def users_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if not is_admin(user_id):
        await update.message.reply_text("⛔ অ্যাডমিন অনুমতি নেই।")
        return
    
    conn = sqlite3.connect(db.DB_NAME)
    c = conn.cursor()
    c.execute('SELECT user_id, daily_limit, today_count, last_reset FROM users')
    rows = c.fetchall()
    conn.close()
    
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

# ----- মেইন ফাংশন -----
def main():
    app = Application.builder().token(config.BOT_TOKEN).build()
    
    # কমান্ড রেজিস্টার
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("send", send_command))
    app.add_handler(CommandHandler("status", status))
    app.add_handler(CommandHandler("admin", admin_panel))
    app.add_handler(CommandHandler("setapikey", set_apikey))
    app.add_handler(CommandHandler("setlimit", set_limit))
    app.add_handler(CommandHandler("users", users_list))
    
    # fallback (অজানা কমান্ড)
    async def unknown(update: Update, context: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text("🤔 অজানা কমান্ড। `/start` টাইপ করে সাহায্য নিন।")
    app.add_handler(MessageHandler(filters.COMMAND, unknown))
    
    print("🤖 বট চালু হয়েছে...")
    app.run_polling()

if __name__ == "__main__":
    main()
