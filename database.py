import sqlite3
import datetime
import os

DB_PATH = "/tmp/sms.db"  # Vercel-এ /tmp রিড-রাইটযোগ্য

def get_db():
    conn = sqlite3.connect(DB_PATH)
    return conn

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
    # ডিফল্ট API key (যদি না থাকে)
    c.execute('''
        INSERT OR IGNORE INTO config (key, value)
        VALUES ('api_key', ?)
    ''', (os.environ.get("DEFAULT_API_KEY", "di80n58vVw6UDgQfH0bxtl3N3dR1i4yA6pfhPXEz"),))
    conn.commit()
    conn.close()

def get_user(user_id):
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

# ডেটাবেস ইনিশিয়ালাইজ
init_db()
