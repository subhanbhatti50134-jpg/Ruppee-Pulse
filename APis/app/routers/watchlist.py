from fastapi import APIRouter, Request

from .. import db
from ..models import WatchlistIn
from .auth import get_current_user

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


@router.get("")
def list_watchlist(request: Request):
    user = get_current_user(request)
    return {"symbols": db.list_watchlist(user["id"])}


@router.post("")
def add_symbol(payload: WatchlistIn, request: Request):
    user = get_current_user(request)
    symbol = payload.symbol.upper()
    if not symbol.endswith("USDT"):
        symbol += "USDT"
    db.add_watchlist(user["id"], symbol)
    return {"symbols": db.list_watchlist(user["id"])}


@router.delete("/{symbol}")
def remove_symbol(symbol: str, request: Request):
    user = get_current_user(request)
    db.remove_watchlist(user["id"], symbol.upper())
    return {"symbols": db.list_watchlist(user["id"])}
