from fastapi import APIRouter, Query

from ..p2p import (
    aggregator,
    compute_premium,
    get_ads,
    get_analytics,
    get_interbank_rate,
    get_p2p_state,
    premium_history,
    scan_arbitrage,
)

router = APIRouter(prefix="/api/p2p", tags=["p2p"])


@router.get("/rates")
async def rates():
    state = get_p2p_state()
    interbank = get_interbank_rate()
    if not state.get("ts"):
        try:
            data = await aggregator.refresh_once()
            return data
        except Exception as exc:
            return {"p2p": state, "interbank": interbank, "premium": None, "ma": None, "error": str(exc)}
    return {
        "p2p": state,
        "interbank": interbank,
        "premium": compute_premium(state, interbank),
        "ma": premium_history.moving_average(),
    }


@router.get("/analytics")
def analytics():
    return get_analytics()


@router.get("/ads")
async def ads(side: str = Query("both", pattern="^(buy|sell|both)$"), limit: int = Query(40, ge=1, le=80)):
    """Raw (trimmed) Binance P2P ads — buy = merchant sells USDT, sell = merchant buys."""
    snapshot = get_ads()
    if not snapshot.get("ts"):
        try:
            await aggregator.refresh_once()
        except Exception:
            pass
        snapshot = get_ads()
    rows = snapshot.get("ads") or []
    if side != "both":
        rows = [r for r in rows if r["side"] == side]
    return {
        "ts": snapshot.get("ts"),
        "count": len(rows),
        "side": side,
        "interbank": get_interbank_rate(),
        "ads": rows[:limit],
    }


@router.get("/arbitrage")
async def arbitrage():
    """Round-trip margin scan across P2P payment methods."""
    state = get_p2p_state()
    if not state.get("ts"):
        try:
            await aggregator.refresh_once()
            state = get_p2p_state()
        except Exception as exc:
            return {"error": str(exc), "rows": [], "opportunities": [], "cross": {}}
    return scan_arbitrage(state, get_interbank_rate())
