import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = os.environ.get("RP_DB_PATH", str(DATA_DIR / "ruppepulse.db"))

MASTER_KEY = os.environ.get("RP_MASTER_KEY", "")
if not MASTER_KEY:
    key_file = DATA_DIR / "master.key"
    if key_file.exists():
        MASTER_KEY = key_file.read_text().strip()
    else:
        MASTER_KEY = secrets.token_urlsafe(48)
        key_file.write_text(MASTER_KEY)
        try:
            key_file.chmod(0o600)
        except OSError:
            pass

CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "RP_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]

WATCHED_SYMBOLS = [
    s.strip().upper()
    for s in os.environ.get(
        "RP_SYMBOLS",
        "BTC,ETH,BNB,SOL,XRP,DOGE,ADA,TRX,AVAX,LINK,DOT,LTC,BCH,UNI,XLM,POL",
    ).split(",")
    if s.strip()
]

P2P_REFRESH_SECONDS = int(os.environ.get("RP_P2P_REFRESH_SECONDS", "60"))
FX_REFRESH_SECONDS = int(os.environ.get("RP_FX_REFRESH_SECONDS", "3600"))
HISTORY_MAX_POINTS = int(os.environ.get("RP_HISTORY_MAX_POINTS", "720"))
PREMIUM_MA_WINDOW = int(os.environ.get("RP_PREMIUM_MA_WINDOW", "30"))
PREMIUM_MA_DEVIATION_PCT = float(os.environ.get("RP_PREMIUM_MA_DEVIATION_PCT", "1.5"))
SESSION_TTL_SECONDS = int(os.environ.get("RP_SESSION_TTL_SECONDS", str(7 * 24 * 3600)))
DEMO_STARTING_BALANCE = float(os.environ.get("RP_DEMO_BALANCE", "100000"))
ALERT_RETENTION = int(os.environ.get("RP_ALERT_RETENTION", "200"))

# Phase 2: arbitrage scanner + Telegram
# Minimum round-trip margin (PKR per USDT) before an arbitrage alert fires.
ARB_MARGIN_PCT = float(os.environ.get("RP_ARB_MARGIN_PCT", "1.0"))
PREMIUM_SAMPLE_RETENTION = int(os.environ.get("RP_PREMIUM_SAMPLE_RETENTION", "4320"))  # 3 days @1/min
TELEGRAM_BOT_TOKEN = os.environ.get("RP_TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("RP_TELEGRAM_CHAT_ID", "")
