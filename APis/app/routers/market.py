from fastapi import APIRouter, HTTPException, Query

from ..binance_stream import fetch_klines, get_tickers, rest_get, stream
from ..cache import cache
from ..config import WATCHED_SYMBOLS
from ..p2p import get_interbank_rate, get_p2p_state

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/tickers")
def tickers():
    data = get_tickers()
    p2p = get_p2p_state()
    rate = (p2p.get("buy") or {}).get("best") or get_interbank_rate()
    enriched = {}
    for symbol, ticker in data.items():
        item = dict(ticker)
        item["price_pkr"] = round(ticker["price"] * rate, 2) if rate else None
        enriched[symbol] = item
    return {
        "data": enriched,
        "symbols": [f"{s}USDT" for s in WATCHED_SYMBOLS],
        "stream_connected": stream.connected,
        "interbank": get_interbank_rate(),
        "p2p_rate": rate,
    }


@router.get("/klines")
async def klines(
    symbol: str = Query(..., min_length=6, max_length=20),
    interval: str = Query("1h", pattern="^(1m|5m|15m|30m|1h|4h|1d|1w)$"),
    limit: int = Query(200, ge=10, le=1000),
):
    symbol = symbol.upper()
    if not symbol.endswith("USDT"):
        symbol += "USDT"
    try:
        candles = await fetch_klines(symbol, interval, limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Binance klines error: {exc}") from exc
    return {"symbol": symbol, "interval": interval, "data": candles}


@router.get("/depth")
async def depth(
    symbol: str = Query(..., min_length=6, max_length=20),
    limit: int = Query(20, ge=5, le=100),
):
    """Order book snapshot from Binance (cached 2s so polling stays polite)."""
    symbol = symbol.upper()
    if not symbol.endswith("USDT"):
        symbol += "USDT"
    key = f"depth:{symbol}:{limit}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    try:
        raw = await rest_get("/api/v3/depth", {"symbol": symbol, "limit": limit}, timeout=6.0)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Order book error: {exc}") from exc
    bids = [{"price": float(p), "qty": float(q)} for p, q in raw.get("bids", [])]
    asks = [{"price": float(p), "qty": float(q)} for p, q in raw.get("asks", [])]
    spread = None
    if bids and asks:
        spread = round(asks[0]["price"] - bids[0]["price"], 8)
    payload = {
        "symbol": symbol,
        "last_update_id": raw.get("lastUpdateId"),
        "bids": bids,
        "asks": asks,
        "spread": spread,
    }
    cache.set(key, payload, ttl=2.0)
    return payload
