"""Stop-loss / take-profit engine: watches live prices, fires market orders at the trigger."""

import asyncio
import logging
from types import SimpleNamespace

from . import db
from .alerts import alert_engine
from .binance_stream import get_price_async
from .trade import place_order

log = logging.getLogger("rp.stops")

CHECK_SECONDS = 5
# Symbols we have already warned about (once per process, not per sweep).
_price_missing: set[str] = set()


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
    exec_type = stop.get("order_type") or "MARKET"
    req = SimpleNamespace(
        symbol=stop["symbol"],
        side=stop["side"],
        type=exec_type,
        quantity=stop.get("quantity"),
        quote_quantity=stop.get("quote_quantity"),
        price=stop.get("limit_price") if exec_type == "LIMIT" else None,
        mode=stop.get("mode") or "auto",
    )
    if exec_type == "LIMIT" and not req.price:
        db.finalize_stop_order(stop["id"], error="stop-limit missing limit price")
        return
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
    canceled = db.cancel_stop_group_siblings(stop["user_id"], stop.get("group_id"), stop["id"])
    exec_label = "limit" if exec_type == "LIMIT" else "market"
    verb = "filled" if order.get("status") == "FILLED" else order.get("status", "placed")
    pair_note = f" · OCO canceled {canceled} sibling" + ("s" if canceled != 1 else "") if canceled else ""
    await alert_engine._emit(
        "stop",
        f"{stop['kind'].replace('_', ' ')} {stop['symbol']} @ {stop['trigger_price']}: "
        f"{stop['side']} {exec_label} {verb} (order {order['id'][:8]}){pair_note}",
        {
            "stop_id": stop["id"],
            "order_id": order["id"],
            "symbol": stop["symbol"],
            "side": stop["side"],
            "kind": stop["kind"],
            "trigger_price": stop["trigger_price"],
            "status": order.get("status"),
            "order_type": exec_type,
            "group_id": stop.get("group_id"),
            "canceled_siblings": canceled,
        },
        user_id=stop["user_id"],
    )
    log.info("stop %s triggered -> %s (siblings canceled: %d)", stop["id"], order["id"], canceled)


async def process_pending_stops() -> int:
    fired = 0
    for stop in db.list_pending_stop_orders():
        try:
            price = await get_price_async(stop["symbol"])
            if price is None:
                if stop["symbol"] not in _price_missing:
                    _price_missing.add(stop["symbol"])
                    log.warning(
                        "no price source for %s — stop %s stays pending",
                        stop["symbol"],
                        stop["id"],
                    )
                continue
            _price_missing.discard(stop["symbol"])
            if should_trigger(stop, price):
                await process_stop(stop)
                fired += 1
        except Exception as exc:
            log.warning("stop check failed for %s: %s", stop.get("id"), exc)
    return fired


async def stop_loop():
    while True:
        await asyncio.sleep(CHECK_SECONDS)
        try:
            await process_pending_stops()
        except Exception as exc:
            # Never let one bad price lookup kill the engine: the task is not
            # awaited anywhere, so a crash would silently disable every stop.
            log.warning("stop sweep failed: %s", exc)


async def start():
    return asyncio.create_task(stop_loop(), name="stop-engine")
