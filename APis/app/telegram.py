"""Telegram bot notifications for RupeePulse alerts (optional, env-configured)."""

import logging

import httpx

from .config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

log = logging.getLogger("rp.telegram")

API_BASE = "https://api.telegram.org"


def is_configured() -> bool:
    return bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)


async def send_message(text: str) -> bool:
    """Send one message to the configured chat. Never raises."""
    if not is_configured():
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{API_BASE}/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "disable_web_page_preview": True},
            )
            resp.raise_for_status()
            payload = resp.json()
            if not payload.get("ok"):
                log.warning("telegram send rejected: %s", payload.get("description"))
                return False
            return True
    except Exception as exc:
        log.warning("telegram send failed: %s", exc)
        return False


async def test_connection() -> dict:
    """Verify token/chat with getMe + a ping message. Never raises."""
    if not is_configured():
        return {
            "configured": False,
            "ok": False,
            "detail": "Set RP_TELEGRAM_BOT_TOKEN and RP_TELEGRAM_CHAT_ID in APis/.env",
        }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            me = await client.get(f"{API_BASE}/bot{TELEGRAM_BOT_TOKEN}/getMe")
            me.raise_for_status()
            bot = me.json()
            if not bot.get("ok"):
                return {"configured": True, "ok": False, "detail": "Invalid bot token"}
            username = bot["result"].get("username", "?")
            sent = await send_message("RupeePulse connected. Arbitrage alerts are live.")
            return {
                "configured": True,
                "ok": sent,
                "bot": f"@{username}",
                "chat_id": TELEGRAM_CHAT_ID,
                "detail": "Test message delivered" if sent else "Bot valid but chat rejected — is the bot in the chat?",
            }
    except Exception as exc:
        return {"configured": True, "ok": False, "detail": str(exc)}
