from fastapi import APIRouter, HTTPException, Request

from .. import db, trade
from ..models import ApiKeysIn, OrderIn
from ..security import decrypt_secret, encrypt_secret
from .auth import get_current_user

router = APIRouter(prefix="/api/trade", tags=["trade"])


@router.post("/order")
async def place_order(payload: OrderIn, request: Request):
    user = get_current_user(request)
    if not payload.quantity and not payload.quote_quantity:
        raise HTTPException(status_code=400, detail="Provide quantity or total")
    if payload.type == "LIMIT" and not payload.price:
        raise HTTPException(status_code=400, detail="Limit orders require a price")
    try:
        order = await trade.place_order(user, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Order failed: {exc}") from exc
    return {"order": order}


@router.get("/orders")
async def open_orders(request: Request):
    user = get_current_user(request)
    return {"orders": await trade.get_open_orders(user)}


@router.get("/history")
def history(request: Request):
    user = get_current_user(request)
    return {"orders": trade.get_order_history(user)}


@router.delete("/orders/{order_id}")
async def cancel_order(order_id: str, request: Request):
    user = get_current_user(request)
    try:
        order = await trade.cancel_order(user, order_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"order": order}


@router.get("/balances")
async def balances(request: Request):
    user = get_current_user(request)
    mode = "live" if db.get_api_keys(user["id"]) else "demo"
    try:
        return await trade.get_balances(user, mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Balance fetch failed: {exc}") from exc


@router.get("/portfolio")
async def portfolio(request: Request):
    user = get_current_user(request)
    mode = "live" if db.get_api_keys(user["id"]) else "demo"
    try:
        return await trade.get_portfolio(user, mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/equity")
async def equity(request: Request):
    user = get_current_user(request)
    mode = "live" if db.get_api_keys(user["id"]) else "demo"
    try:
        return await trade.get_equity_curve(user, mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Portfolio fetch failed: {exc}") from exc


@router.post("/demo/reset")
def demo_reset(request: Request):
    user = get_current_user(request)
    balances = db.reset_demo_account(user["id"])
    return {"balances": balances, "mode": "demo"}


# ---------------------------------------------------------------- api keys


@router.get("/keys")
def get_keys(request: Request):
    user = get_current_user(request)
    row = db.get_api_keys(user["id"])
    if not row:
        return {"configured": False}
    try:
        key = decrypt_secret(row["encrypted_key"])
        masked = f"{key[:6]}...{key[-4:]}" if len(key) > 12 else "****"
    except Exception:
        masked = "****"
    return {"configured": True, "api_key_masked": masked, "created_at": row["created_at"]}


@router.post("/keys")
def set_keys(payload: ApiKeysIn, request: Request):
    user = get_current_user(request)
    enc_key = encrypt_secret(payload.api_key.strip())
    enc_secret = encrypt_secret(payload.api_secret.strip())
    db.save_api_keys(user["id"], enc_key, enc_secret)
    return {"configured": True, "message": "API keys stored (AES-256-GCM encrypted)"}


@router.delete("/keys")
def delete_keys(request: Request):
    user = get_current_user(request)
    db.delete_api_keys(user["id"])
    return {"configured": False}


@router.post("/keys/test")
async def test_keys(request: Request):
    user = get_current_user(request)
    try:
        return await trade.test_live_keys(user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Connection test failed — {exc}") from exc
