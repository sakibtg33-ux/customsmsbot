import os

# এনভায়রনমেন্ট ভেরিয়েবল থেকে নিন (Vercel-এ সেট করবেন)
BOT_TOKEN = os.environ.get("BOT_TOKEN", "8896805760:AAGt4CDbEdGP_Xedc9p_SpFu4d7rA3QOOSE")
ADMIN_USER_ID = int(os.environ.get("ADMIN_USER_ID", 1700797877))
API_URL = "https://api.sms.net.bd/sendsms"

# ডিফল্ট API key (যদি ডেটাবেসে না থাকে)
DEFAULT_API_KEY = "di80n58vVw6UDgQfH0bxtl3N3dR1i4yA6pfhPXEz"
