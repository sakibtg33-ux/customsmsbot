import json
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler, filters,
    ContextTypes, CallbackContext
)
import config
import database as db
import requests
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------- হেল্পার ----------
def send_sms(api_key, phone, message):
    clean_phone = phone.lstrip('0')
    if len(clean_phone) != 10:
        return False, "ফোন নম্বর ১০ ডিজিটের হতে হবে (০ ছাড়া)"
    url = config.API_URL
    params = {'api_key': api_key, 'msg': message, 'to': '880' + clean_phone}
    try:
        resp = requests.get(url, params=params, timeout=10)
        data = resp.json()
        if data.get('error') == 0:
            return True, f"✅ সফল! Request ID: {data.get('data', {}).get('request_id', 'N/A')}"
        else:
            return False, f"❌ ব্যর্থ: {data.get('msg', 'অজানা ত্রুটি')}"
    except Exception as e:
        return False, f"❌ নেটওয়ার্ক ত্রুটি: {str(e)}"

def is_admin(user_id):
    return user_id == config.ADMIN_USER_ID

# ---------- কমান্ড হ্যান্ডলার ----------
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    db.get_user(user_id)
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
    
    user_data = db.get_user(user_id)
    limit = user_data['daily_limit']
    used = user_data['today_count']
    remaining = limit - used
    if remaining <= 0:
        await update.message.reply_text(f"⛔ আপনি আজকের {limit}টি SMS শেষ করে ফেলেছেন। আগামীকাল চেষ্টা করুন।")
        return
    
    api_key = db.get_api_key()
    if not api_key:
        await update.message.reply_text("❌ API key কনফিগার করা নেই। অ্যাডমিনকে জানান।")
        return
    
    success, msg = send_sms(api_key, phone, message)
    if success:
        db.increment_count(user_id)
        remaining -= 1
        await update.message.reply_text(f"{msg}\n\n📊 আজ বাকি: {remaining}টি")
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
    if not is_admin(user_id):
        await update.message.reply_text("⛔ অ্যাডমিন অনুমতি নেই।")
        return
    args = context.args
    if not args:
        await update.message.reply_text("⚠️ `/setapikey YOUR_API_KEY`")
        return
    db.set_api_key(args[0])
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
    db.set_daily_limit_for_all(new_limit)
    await update.message.reply_text(f"✅ সব ইউজারের দৈনিক সীমা `{new_limit}` এ সেট করা হয়েছে।")

async def users_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if not is_admin(user_id):
        await update.message.reply_text("⛔ অ্যাডমিন অনুমতি নেই।")
        return
    rows = db.get_all_users()
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

# ---------- Vercel Webhook এন্ট্রি ----------
app = None

def create_app():
    global app
    if app is None:
        # বট অ্যাপ্লিকেশন তৈরি
        application = Application.builder().token(config.BOT_TOKEN).build()
        application.add_handler(CommandHandler("start", start))
        application.add_handler(CommandHandler("send", send_command))
        application.add_handler(CommandHandler("status", status))
        application.add_handler(CommandHandler("admin", admin_panel))
        application.add_handler(CommandHandler("setapikey", set_apikey))
        application.add_handler(CommandHandler("setlimit", set_limit))
        application.add_handler(CommandHandler("users", users_list))
        application.add_handler(MessageHandler(filters.COMMAND, unknown))
        app = application
    return app

# Vercel serverless function entry point
async def handler(request):
    """Vercel Python runtime entrypoint"""
    # Webhook থেকে আপডেট পার্স করুন
    try:
        body = await request.body()
        data = json.loads(body)
        update = Update.de_json(data, None)
    except Exception as e:
        return {
            "statusCode": 400,
            "body": json.dumps({"error": str(e)})
        }
    
    application = create_app()
    await application.process_update(update)
    return {
        "statusCode": 200,
        "body": json.dumps({"status": "ok"})
    }

# লোকাল টেস্টিংয়ের জন্য (পোলিং) – Vercel এ ব্যবহার হবে না
if __name__ == "__main__":
    # শুধু লোকাল ডেভেলপমেন্টের জন্য
    import asyncio
    app = create_app()
    asyncio.run(app.run_polling())
