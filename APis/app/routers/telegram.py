from fastapi import APIRouter, Request

from .. import telegram
from .auth import get_current_user

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


@router.get("/status")
def status(request: Request):
    get_current_user(request)
    cfg = telegram.is_configured()
    info = {"configured": cfg}
    if cfg:
        from ..config import TELEGRAM_CHAT_ID

        info["chat_id"] = TELEGRAM_CHAT_ID
    return info


@router.post("/test")
async def test(request: Request):
    get_current_user(request)
    return await telegram.test_connection()
