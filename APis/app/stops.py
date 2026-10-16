"""Stop-loss / take-profit engine: watches live prices, fires market orders at the trigger."""

import asyncio
import logging
from types import SimpleNamespace

from . import db
from .alerts import alert_engine
from .binance_stream import get_price
from .trade import place_order

log = logging.getLogger("rp.stops")

CHECK_SECONDS = 5


def should_trigger(stop: dict, price: float) -> bool:
    """Direction rules mirror Binance spot stops.

    SELL + STOP_LOSS     -> fire when price falls to trigger   (protect a long)
    SELL + TAKE_PROFIT   -> fire when price rises to trigger   (bank a long)
    BUY  + STOP_LOSS     -> fire when price rises to trigger   (protect a short)
    BUY  + TAKE_PROFIT   -> fire when price falls to trigger   (bank a short)
    """
    trig = stop["trigger_price"]
    if stop["kind"] == "STOP_LOSS":
        return price <= trig if stop["side"] == "SELL" else price >= trig
    return price >= trig if stop["side"] == "SELL" else price <= trig


async def process_stop(stop: dict) -> None:
    if not db.claim_stop_order(stop["id"]):
        return
    user = db.get_user(stop["user_id"])
    if not user:
        db.finalize_stop_order(stop["id"], error="user gone")
        return
    req = SimpleNamespace(
        symbol=stop["symbol"],
        side=stop["side"],
        type="MARKET",
        quantity=stop.get("quantity"),
        quote_quantity=stop.get("quote_quantity"),
        price=None,
        mode=stop.get("mode") or "auto",
    )
    try:
        order = await place_order(user, req)
    except Exception as exc:
        db.finalize_stop_order(stop["id"], error=str(exc))
        log.warning("stop %s failed: %s", stop["id"], exc)
        await alert_engine._emit(
            "stop",
            f"{stop['kind'].replace('_', ' ')} on {stop['symbol']} triggered but order failed: {exc}",
            {"stop_id": stop["id"], "symbol": stop["symbol"], "error": str(exc)},
            user_id=stop["user_id"],
        )
        return
    db.finalize_stop_order(stop["id"], linked_order_id=order["id"])
    verb = "filled" if order.get("status") == "FILLED" else order.get("status", "placed")
    await alert_engine._emit(
        "stop",
        f"{stop['kind'].replace('_', ' ')} {stop['symbol']} @ {stop['trigger_price']}: "
        f"{stop['side']} market {verb} (order {order['id'][:8]})",
        {
            "stop_id": stop["id"],
            "order_id": order["id"],
            "symbol": stop["symbol"],
            "side": stop["side"],
            "kind": stop["kind"],
            "trigger_price": stop["trigger_price"],
            "status": order.get("status"),
        },
        user_id=stop["user_id"],
    )
    log.info("stop %s triggered -> %s", stop["id"], order["id"])


async def process_pending_stops() -> int:
    fired = 0
    for stop in db.list_pending_stop_orders():
        price = get_price(stop["symbol"])
        if price is None:
            continue
        try:
            if should_trigger(stop, price):
                await process_stop(stop)
                fired += 1
        except Exception as exc:
            log.warning("stop check failed for %s: %s", stop.get("id"), exc)
    return fired


async def stop_loop():
    while True:
        await asyncio.sleep(CHECK_SECONDS)
        await process_pending_stops()


async def start():
    return asyncio.create_task(stop_loop(), name="stop-engine")
