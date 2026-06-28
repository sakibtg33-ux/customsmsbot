import json
import logging
import requests
from telegram import Update

# লগ সেটআপ
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------- লেজি ইমপোর্ট (মডিউল লোডের সময় না) ----------
_bot_app = None
_webhook_set = False

def get_bot_app():
    global _bot_app
    if _bot_app is None:
        from bot_logic import create_bot_app
        _bot_app = create_bot_app()
    return _bot_app

def set_webhook_if_needed():
    global _webhook_set
    if _webhook_set:
        return
    import config
    vercel_url = "https://customsmsbot.vercel.app"
    webhook_url = f"{vercel_url}/api/index"
    url = f"https://api.telegram.org/bot{config.BOT_TOKEN}/setWebhook"
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
    """Vercel-এর Python runtime-এর জন্য প্রধান এন্ট্রি"""
    try:
        # ওয়েবহুক সেট (শুধু প্রথমবার)
        set_webhook_if_needed()

        # রিকোয়েস্ট বডি পড়ি
        body = await request.body()
        data = json.loads(body)
        update = Update.de_json(data, None)
        if update is None:
            return {"statusCode": 400, "body": json.dumps({"error": "Invalid update"})}
        
        # বট অ্যাপ্লিকেশন পাই
        app = get_bot_app()
        await app.process_update(update)
        return {"statusCode": 200, "body": json.dumps({"status": "ok"})}
    except Exception as e:
        logger.error(f"Handler error: {e}", exc_info=True)
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
