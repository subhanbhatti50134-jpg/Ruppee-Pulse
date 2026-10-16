"""Trade execution: live Binance orders (signed) + demo paper engine + balances."""

import asyncio
import logging
import math
import time
import uuid

from . import db
from .binance_stream import BinanceAPIError, fetch_klines, get_price, get_tickers, signed_request
from .security import decrypt_secret

log = logging.getLogger("rp.trade")

PRICE_DECIMALS = {
    "BTCUSDT": 2,
    "ETHUSDT": 3,
    "BNBUSDT": 3,
    "XRPUSDT": 4,
    "DOGEUSDT": 5,
}


def round_qty(qty: float) -> float:
    if qty >= 100:
        return math.floor(qty * 100) / 100
    if qty >= 1:
        return math.floor(qty * 1000) / 1000
    return math.floor(qty * 100000) / 100000


def round_price(price: float) -> float:
    if price >= 1000:
        return round(price, 2)
    if price >= 1:
        return round(price, 4)
    return round(price, 6)


def _order_view(order: dict) -> dict:
    total = None
    if order.get("type") == "LIMIT" and order.get("price"):
        total = order["price"] * order["quantity"]
    elif order.get("avg_price"):
        total = order["avg_price"] * order["quantity"]
    elif order.get("quote_quantity"):
        total = order["quote_quantity"]
    return {
        "id": order["id"],
        "symbol": order["symbol"],
        "side": order["side"],
        "type": order["type"],
        "price": order.get("price"),
        "quantity": order["quantity"],
        "quote_quantity": order.get("quote_quantity"),
        "status": order["status"],
        "mode": order["mode"],
        "avg_price": order.get("avg_price"),
        "total": round(total, 6) if total else None,
        "binance_order_id": order.get("binance_order_id"),
        "created_at": order["created_at"],
        "updated_at": order["updated_at"],
    }


# ---------------------------------------------------------------- live mode


async def _live_balances(user: dict) -> list[dict]:
    keys = db.get_api_keys(user["id"])
    if not keys:
        raise ValueError("No Binance API keys configured")
    api_key = decrypt_secret(keys["encrypted_key"])
    api_secret = decrypt_secret(keys["encrypted_secret"])
    account = await signed_request(api_key, api_secret, "GET", "/api/v3/account")
    tickers = get_tickers()
    balances = []
    for item in account.get("balances", []):
        free = float(item["free"])
        locked = float(item["locked"])
        if free <= 0 and locked <= 0:
            continue
        asset = item["asset"]
        symbol = f"{asset}USDT"
        price = tickers.get(symbol, {}).get("price") if asset != "USDT" else 1.0
        if price is None:
            try:
                quote = await signed_request(
                    api_key, api_secret, "GET", "/api/v3/ticker/price", {"symbol": symbol}
                )
                price = float(quote["price"])
            except Exception:
                price = 0.0
        value = round((free + locked) * price, 6)
        balances.append(
            {
                "asset": asset,
                "free": free,
                "locked": locked,
                "price_usd": price,
                "value_usd": value,
                "value_pkr": round(value * _pkr_rate(), 2) if price else 0.0,
            }
        )
    balances.sort(key=lambda b: -b["value_usd"])
    return balances


def _pkr_rate() -> float:
    from .p2p import get_interbank_rate, get_p2p_state

    state = get_p2p_state()
    best = (state.get("buy") or {}).get("best")
    if best:
        return float(best)
    return get_interbank_rate() or 0.0


async def _live_open_orders(user: dict) -> list[dict]:
    keys = db.get_api_keys(user["id"])
    api_key = decrypt_secret(keys["encrypted_key"])
    api_secret = decrypt_secret(keys["encrypted_secret"])
    orders = await signed_request(api_key, api_secret, "GET", "/api/v3/openOrders")
    return [
        {
            "binance_order_id": str(o["orderId"]),
            "symbol": o["symbol"],
            "side": o["side"],
            "type": o["type"],
            "price": float(o.get("price") or 0),
            "quantity": float(o.get("origQty") or 0),
            "status": o["status"],
            "mode": "live",
            "created_at": o.get("time", 0) / 1000,
            "updated_at": o.get("updateTime", 0) / 1000,
        }
        for o in orders
    ]


async def test_live_keys(user: dict) -> dict:
    """Validate stored keys against Binance and report account permissions.

    Uses GET /api/v3/account only (read permission) — no order is placed.
    """
    keys = db.get_api_keys(user["id"])
    if not keys:
        raise ValueError("No API keys configured")
    api_key = decrypt_secret(keys["encrypted_key"])
    api_secret = decrypt_secret(keys["encrypted_secret"])
    account = await signed_request(api_key, api_secret, "GET", "/api/v3/account")
    funded = [
        b
        for b in account.get("balances", [])
        if float(b.get("free") or 0) + float(b.get("locked") or 0) > 1e-12
    ]
    return {
        "ok": True,
        "can_trade": bool(account.get("canTrade")),
        "can_withdraw": bool(account.get("canWithdraw")),
        "can_deposit": bool(account.get("canDeposit")),
        "permissions": list(account.get("permissions") or []),
        "nonzero_balances": len(funded),
        "ts": time.time(),
    }


async def place_live_order(user: dict, req) -> dict:
    keys = db.get_api_keys(user["id"])
    if not keys:
        raise ValueError("No Binance API keys configured. Add them in Profile.")
    api_key = decrypt_secret(keys["encrypted_key"])
    api_secret = decrypt_secret(keys["encrypted_secret"])
    symbol = req.symbol.upper()

    params: dict = {"symbol": symbol, "side": req.side, "type": req.type}
    if req.type == "MARKET":
        if req.quote_quantity:
            params["quoteOrderQty"] = f"{req.quote_quantity:.8f}"
        elif req.quantity:
            params["quantity"] = f"{req.quantity:.8f}"
        else:
            raise ValueError("Provide quantity or total for a market order")
    else:
        if req.price is None:
            raise ValueError("Limit orders require a price")
        if not req.quantity:
            raise ValueError("Limit orders require a quantity")
        params.update(
            {"timeInForce": "GTC", "quantity": f"{req.quantity:.8f}", "price": f"{req.price:.8f}"}
        )

    try:
        result = await signed_request(api_key, api_secret, "POST", "/api/v3/order", params)
    except BinanceAPIError as exc:
        order = {
            "id": uuid.uuid4().hex,
            "user_id": user["id"],
            "symbol": symbol,
            "side": req.side,
            "type": req.type,
            "price": req.price,
            "quantity": req.quantity or 0,
            "quote_quantity": req.quote_quantity,
            "status": "REJECTED",
            "mode": "live",
            "binance_order_id": None,
            "avg_price": None,
            "created_at": time.time(),
            "updated_at": time.time(),
            "error": exc.message,
        }
        db.insert_order({k: v for k, v in order.items() if k != "error"})
        raise ValueError(exc.message) from exc

    status = result.get("status", "NEW")
    executed = float(result.get("executedQty") or 0)
    quote_executed = float(result.get("cummulativeQuoteQty") or 0)
    avg_price = round(quote_executed / executed, 8) if executed and quote_executed else None
    order = {
        "id": uuid.uuid4().hex,
        "user_id": user["id"],
        "symbol": symbol,
        "side": req.side,
        "type": req.type,
        "price": float(result.get("price") or 0) or req.price,
        "quantity": float(result.get("origQty") or req.quantity or 0),
        "quote_quantity": req.quote_quantity,
        "status": status,
        "mode": "live",
        "binance_order_id": str(result.get("orderId")),
        "avg_price": avg_price,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    db.insert_order(order)
    return _order_view(order)


# ---------------------------------------------------------------- demo mode


async def place_demo_order(user: dict, req) -> dict:
    symbol = req.symbol.upper()
    price = get_price(symbol)
    if price is None:
        try:
            candles = await fetch_klines(symbol, "1m", 2)
            price = float(candles[-1][4])
        except Exception as exc:
            raise ValueError(f"Price unavailable for {symbol}: {exc}") from exc
    if req.type == "LIMIT" and req.price:
        price = req.price

    balances = db.get_demo_balances(user["id"])
    base = symbol[: -len("USDT")] if symbol.endswith("USDT") else symbol
    qty = req.quantity
    if req.type == "MARKET" and req.quote_quantity and not qty:
        qty = round_qty(req.quote_quantity / price)
    if not qty or qty <= 0:
        raise ValueError("Quantity is required")

    total = round(qty * price, 8)

    def _bal(asset: str) -> dict:
        return balances.setdefault(asset, {"free": 0.0, "locked": 0.0})

    if req.type == "MARKET":
        if req.side == "BUY":
            usdt = _bal("USDT")
            if usdt["free"] < total:
                raise ValueError(
                    f"Insufficient demo USDT: need {total:.2f}, have {usdt['free']:.2f}"
                )
            usdt["free"] -= total
            asset = _bal(base)
            asset["free"] += qty
            status, avg_price = "FILLED", price
        else:
            asset = _bal(base)
            if asset["free"] < qty:
                raise ValueError(f"Insufficient demo {base}: need {qty}, have {asset['free']}")
            asset["free"] -= qty
            usdt = _bal("USDT")
            usdt["free"] += total
            status, avg_price = "FILLED", price
    else:
        if req.price is None:
            raise ValueError("Limit orders require a price")
        if req.side == "BUY":
            usdt = _bal("USDT")
            if usdt["free"] < total:
                raise ValueError(
                    f"Insufficient demo USDT: need {total:.2f}, have {usdt['free']:.2f}"
                )
            usdt["free"] -= total
            usdt["locked"] += total
        else:
            asset = _bal(base)
            if asset["free"] < qty:
                raise ValueError(f"Insufficient demo {base}: need {qty}, have {asset['free']}")
            asset["free"] -= qty
            asset["locked"] += qty
        status, avg_price = "NEW", None

    db.save_demo_balances(user["id"], balances)
    order = {
        "id": uuid.uuid4().hex,
        "user_id": user["id"],
        "symbol": symbol,
        "side": req.side,
        "type": req.type,
        "price": req.price,
        "quantity": qty,
        "quote_quantity": total if req.type == "MARKET" else None,
        "status": status,
        "mode": "demo",
        "binance_order_id": None,
        "avg_price": avg_price,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    db.insert_order(order)
    return _order_view(order)


async def cancel_demo_order(order: dict) -> dict:
    if order["status"] != "NEW":
        raise ValueError("Only open demo orders can be cancelled")
    balances = db.get_demo_balances(order["user_id"])
    base = order["symbol"][: -len("USDT")]
    total = round((order.get("price") or 0) * order["quantity"], 8)
    usdt = balances.setdefault("USDT", {"free": 0.0, "locked": 0.0})
    if order["side"] == "BUY":
        usdt["locked"] = max(0.0, usdt["locked"] - total)
        usdt["free"] += total
    else:
        asset = balances.setdefault(base, {"free": 0.0, "locked": 0.0})
        asset["locked"] = max(0.0, asset["locked"] - order["quantity"])
        asset["free"] += order["quantity"]
    db.save_demo_balances(order["user_id"], balances)
    db.update_order(order["id"], status="CANCELED")
    order["status"] = "CANCELED"
    return _order_view(order)


async def cancel_live_order(user: dict, order: dict) -> dict:
    keys = db.get_api_keys(user["id"])
    if not keys:
        raise ValueError("No Binance API keys configured")
    api_key = decrypt_secret(keys["encrypted_key"])
    api_secret = decrypt_secret(keys["encrypted_secret"])
    try:
        await signed_request(
            api_key,
            api_secret,
            "DELETE",
            "/api/v3/order",
            {"symbol": order["symbol"], "orderId": order["binance_order_id"]},
        )
    except BinanceAPIError as exc:
        raise ValueError(exc.message) from exc
    db.update_order(order["id"], status="CANCELED")
    order["status"] = "CANCELED"
    return _order_view(order)


# ---------------------------------------------------------------- demo fill loop


async def process_demo_fills():
    """Fill open demo limit orders when the live market crosses their price."""
    for order in db.list_open_demo_orders():
        try:
            price = get_price(order["symbol"])
            if price is None:
                continue
            limit_price = order.get("price")
            if not limit_price:
                continue
            fill = None
            if order["side"] == "BUY" and price <= limit_price:
                fill = limit_price
            elif order["side"] == "SELL" and price >= limit_price:
                fill = limit_price
            if fill is None:
                continue
            balances = db.get_demo_balances(order["user_id"])
            base = order["symbol"][: -len("USDT")]
            total = round(fill * order["quantity"], 8)
            usdt = balances.setdefault("USDT", {"free": 0.0, "locked": 0.0})
            asset = balances.setdefault(base, {"free": 0.0, "locked": 0.0})
            if order["side"] == "BUY":
                usdt["locked"] = max(0.0, usdt["locked"] - total)
                asset["free"] += order["quantity"]
            else:
                asset["locked"] = max(0.0, asset["locked"] - order["quantity"])
                usdt["free"] += total
            db.save_demo_balances(order["user_id"], balances)
            db.update_order(order["id"], status="FILLED", avg_price=fill)
            log.info("demo order filled: %s %s @ %s", order["symbol"], order["side"], fill)
        except Exception as exc:
            log.warning("demo fill failed for %s: %s", order.get("id"), exc)


async def demo_fill_loop():
    while True:
        await asyncio.sleep(3)
        await process_demo_fills()


# ---------------------------------------------------------------- unified api


async def get_balances(user: dict, mode: str) -> dict:
    if mode == "live":
        balances = await _live_balances(user)
    else:
        balances = _demo_balance_view(db.get_demo_balances(user["id"]))
    total = sum(b["value_usd"] for b in balances)
    rate = _pkr_rate()
    return {
        "mode": mode,
        "balances": balances,
        "total_usd": round(total, 2),
        "total_pkr": round(total * rate, 2),
        "pkr_rate": rate,
    }


def _demo_balance_view(balances: dict) -> list[dict]:
    tickers = get_tickers()
    rate = _pkr_rate()
    out = []
    for asset, amounts in balances.items():
        free = float(amounts.get("free", 0))
        locked = float(amounts.get("locked", 0))
        if free <= 0 and locked <= 0:
            continue
        if asset == "USDT":
            price = 1.0
        else:
            price = tickers.get(f"{asset}USDT", {}).get("price", 0.0)
        value = round((free + locked) * price, 6)
        out.append(
            {
                "asset": asset,
                "free": free,
                "locked": locked,
                "price_usd": price,
                "value_usd": value,
                "value_pkr": round(value * rate, 2),
            }
        )
    out.sort(key=lambda b: -b["value_usd"])
    return out


async def place_order(user: dict, req) -> dict:
    mode = req.mode
    if mode == "auto":
        mode = "live" if db.get_api_keys(user["id"]) else "demo"
    if mode == "live":
        return await place_live_order(user, req)
    return await place_demo_order(user, req)


async def cancel_order(user: dict, order_id: str) -> dict:
    order = next((o for o in db.list_orders(user["id"], limit=200) if o["id"] == order_id), None)
    if not order:
        raise ValueError("Order not found")
    if order["status"] not in ("NEW", "PARTIALLY_FILLED"):
        raise ValueError("Order is not open")
    if order["mode"] == "demo":
        return await cancel_demo_order(order)
    return await cancel_live_order(user, order)


async def get_open_orders(user: dict) -> list[dict]:
    local = [
        _order_view(o)
        for o in db.list_orders(user["id"], status="NEW", limit=100)
    ]
    if db.get_api_keys(user["id"]):
        try:
            remote = await _live_open_orders(user)
            seen = {o["binance_order_id"] for o in local if o.get("binance_order_id")}
            local.extend([r for r in remote if r["binance_order_id"] not in seen])
        except Exception as exc:
            log.warning("live open orders failed: %s", exc)
    local.sort(key=lambda o: -o["created_at"])
    return local


def get_order_history(user: dict, limit: int = 50) -> list[dict]:
    """History rows, with realized P&L attributed to each filled sell."""
    views = [_order_view(o) for o in db.list_orders(user["id"], limit=limit)]
    _, per_sell = _walk_fills(_filled_orders(user["id"]))
    for v in views:
        if v["status"] == "FILLED" and v["side"] == "SELL":
            v["pnl"] = round(per_sell.get(v["id"], 0.0), 6)
        else:
            v["pnl"] = None
    return views


# ---------------------------------------------------------------- portfolio PnL


def _filled_orders(user_id: str) -> list[dict]:
    fills = [
        o
        for o in db.list_orders(user_id, limit=1000)
        if o["status"] == "FILLED" and o.get("avg_price")
    ]
    fills.sort(key=lambda o: o["created_at"])
    return fills


def _walk_fills(fills: list[dict]) -> tuple[dict[str, dict], dict[str, float]]:
    """Chronological average-cost walk over filled orders.

    Returns books per asset plus realized P&L attributed to each sell order id,
    so per-trade profit (history) and aggregate portfolio P&L can never disagree.
    """
    books: dict[str, dict] = {}
    per_sell: dict[str, float] = {}
    for o in fills:
        base = o["symbol"][: -len("USDT")] if o["symbol"].endswith("USDT") else o["symbol"]
        book = books.setdefault(base, {"qty": 0.0, "cost": 0.0, "realized": 0.0})
        price = o["avg_price"]
        qty = float(o["quantity"] or 0)
        if qty <= 0 or price <= 0:
            continue
        if o["side"] == "BUY":
            book["cost"] += price * qty
            book["qty"] += qty
        else:
            sell_qty = min(qty, book["qty"])
            avg = (book["cost"] / book["qty"]) if book["qty"] > 1e-12 else price
            gain = (price - avg) * sell_qty
            book["realized"] += gain
            per_sell[o["id"]] = gain
            book["qty"] -= sell_qty
            book["cost"] = avg * book["qty"]
            if book["qty"] <= 1e-12:
                book["qty"] = 0.0
                book["cost"] = 0.0
    return books, per_sell


def compute_portfolio(user: dict, mode: str) -> dict:
    """Average-cost PnL per asset: realized + unrealized + allocation weights."""
    books, _ = _walk_fills(_filled_orders(user["id"]))
    realized = sum(b["realized"] for b in books.values())

    tickers = get_tickers()
    rate = _pkr_rate()

    positions = []
    unrealized = 0.0
    for asset, book in books.items():
        if book["qty"] <= 1e-12 and book["realized"] == 0:
            continue
        price = tickers.get(f"{asset}USDT", {}).get("price", 0.0) if asset != "USDT" else 1.0
        avg_cost = (book["cost"] / book["qty"]) if book["qty"] > 1e-12 else None
        value = round(book["qty"] * price, 6) if price else 0.0
        upnl = round((price - avg_cost) * book["qty"], 6) if avg_cost is not None and price else 0.0
        unrealized += upnl
        positions.append({
            "asset": asset,
            "qty": round(book["qty"], 8),
            "avg_cost": round(avg_cost, 8) if avg_cost else None,
            "price_usd": price,
            "value_usd": value,
            "value_pkr": round(value * rate, 2) if rate else 0.0,
            "unrealized_pnl": upnl,
            "unrealized_pnl_pct": round((price / avg_cost - 1) * 100, 3)
            if avg_cost and price else None,
            "realized_pnl": round(book["realized"], 6),
        })
    positions.sort(key=lambda p: -p["value_usd"])
    return {
        "mode": mode,
        "positions": positions,
        "realized_pnl": round(realized, 6),
        "unrealized_pnl": round(unrealized, 6),
        "total_pnl": round(realized + unrealized, 6),
        "ts": time.time(),
    }


async def get_portfolio(user: dict, mode: str) -> dict:
    """Portfolio with balances merged in (async for live-mode account fetch)."""
    bal = await get_balances(user, mode)
    portfolio = compute_portfolio(user, mode)
    held = {b["asset"]: b for b in bal["balances"]}
    total_value = bal["total_usd"] or 1.0
    allocation = [
        {
            "asset": b["asset"],
            "value_usd": b["value_usd"],
            "weight_pct": round(b["value_usd"] / total_value * 100, 2),
            "price_usd": b["price_usd"],
            "free": b["free"],
            "locked": b["locked"],
        }
        for b in bal["balances"]
    ]
    # attach allocation + current value to matching positions
    for pos in portfolio["positions"]:
        h = held.get(pos["asset"])
        if h:
            pos["value_usd"] = h["value_usd"]
            pos["value_pkr"] = h["value_pkr"]
            pos["free"] = h["free"]
            pos["locked"] = h["locked"]
            pos["qty"] = round(h["free"] + h["locked"], 8)
    return {
        **portfolio,
        "balances": bal["balances"],
        "allocation": allocation,
        "total_value_usd": bal["total_usd"],
        "total_value_pkr": bal["total_pkr"],
        "pkr_rate": bal["pkr_rate"],
    }


async def get_equity_curve(user: dict, mode: str, limit: int = 500) -> dict:
    """Portfolio value over time.

    Replays fill events forward from a start state derived by unwinding today's
    balances, valuing each holding at its latest known fill price between trades
    and marking the final point with live balance prices. Anchoring to actual
    balances keeps deposits/resets/external moves correct by construction.
    """
    bal = await get_balances(user, mode)
    usdt_end = 0.0
    holdings_end: dict[str, float] = {}
    for b in bal["balances"]:
        qty = float(b["free"]) + float(b["locked"])
        if b["asset"] == "USDT":
            usdt_end = qty
        elif qty > 1e-12:
            holdings_end[b["asset"]] = qty
    equity_end = float(bal["total_usd"] or 0.0)

    events = _filled_orders(user["id"])
    cash_delta = 0.0
    qty_delta: dict[str, float] = {}
    for o in events:
        base = o["symbol"][: -len("USDT")] if o["symbol"].endswith("USDT") else o["symbol"]
        price, qty = float(o["avg_price"]), float(o["quantity"])
        if price <= 0 or qty <= 0:
            continue
        total = price * qty
        cash_delta += total if o["side"] == "SELL" else -total
        qty_delta[base] = qty_delta.get(base, 0.0) + (qty if o["side"] == "BUY" else -qty)

    cash = usdt_end - cash_delta
    holdings = {
        a: holdings_end.get(a, 0.0) - qty_delta.get(a, 0.0)
        for a in set(holdings_end) | set(qty_delta)
    }

    tickers = get_tickers()

    def _live_price(asset: str) -> float:
        if asset == "USDT":
            return 1.0
        return float(tickers.get(f"{asset}USDT", {}).get("price") or 0.0)

    last_price = {a: _live_price(a) for a in holdings}

    def _mark() -> float:
        total = cash
        for a, q in holdings.items():
            if q > 1e-12:
                total += q * (last_price.get(a, 0.0) or _live_price(a))
        return total

    points: list[dict] = []
    for o in events:
        base = o["symbol"][: -len("USDT")] if o["symbol"].endswith("USDT") else o["symbol"]
        price, qty = float(o["avg_price"]), float(o["quantity"])
        if price <= 0 or qty <= 0:
            continue
        total = price * qty
        last_price[base] = price
        if o["side"] == "BUY":
            cash -= total
            holdings[base] = holdings.get(base, 0.0) + qty
        else:
            cash += total
            holdings[base] = holdings.get(base, 0.0) - qty
        points.append({"ts": o["created_at"], "equity": round(_mark(), 6), "cash": round(cash, 6)})

    last_ts = points[-1]["ts"] if points else 0.0
    points.append({"ts": max(time.time(), last_ts + 1), "equity": round(equity_end, 6), "cash": round(usdt_end, 6)})
    points = points[-max(limit, 2) :]

    _, per_sell = _walk_fills(events)
    realized = sum(per_sell.values())
    start_equity = points[0]["equity"]
    change = round(equity_end - start_equity, 6)
    return {
        "mode": mode,
        "points": points,
        "start_equity": start_equity,
        "current_equity": round(equity_end, 6),
        "change": change,
        "change_pct": round(change / start_equity * 100, 3) if start_equity else None,
        "realized_pnl": round(realized, 6),
        "ts": time.time(),
    }
