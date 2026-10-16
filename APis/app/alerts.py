"""Arbitrage & premium alerts: MA-deviation engine + user threshold rules + price alerts."""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from . import db, telegram
from .binance_stream import get_tickers
from .config import ARB_MARGIN_PCT, PREMIUM_MA_DEVIATION_PCT, PREMIUM_MA_WINDOW
from .p2p import best_arb_margin_pct, get_interbank_rate, get_p2p_state, premium_history, scan_arbitrage

log = logging.getLogger("rp.alerts")

COOLDOWN_SECONDS = 300
PRICE_COOLDOWN_SECONDS = 60
ARB_COOLDOWN_SECONDS = 600
PRICE_CHECK_SECONDS = 5
_last_global_alert: dict[str, float] = {}


class AlertEngine:
    def __init__(self):
        self._subscribers: list[Callable[[dict], Awaitable[None]]] = []
        self._task: asyncio.Task | None = None
        self._price_task: asyncio.Task | None = None

    def subscribe(self, callback: Callable[[dict], Awaitable[None]]):
        self._subscribers.append(callback)

    def unsubscribe(self, callback: Callable[[dict], Awaitable[None]]):
        if callback in self._subscribers:
            self._subscribers.remove(callback)

    async def _emit(self, kind: str, message: str, payload: dict, user_id: str | None = None, notify: bool = True):
        event = db.insert_alert_event(kind, message, payload, user_id=user_id)
        envelope = {"type": "alert", "data": event}
        for callback in list(self._subscribers):
            try:
                await callback(envelope)
            except Exception as exc:
                log.debug("alert broadcast failed: %s", exc)
        if notify and telegram.is_configured():
            await telegram.send_message(f"🔔 RupeePulse\n{message}")

    async def evaluate(self):
        latest = premium_history.latest()
        ma = premium_history.moving_average(PREMIUM_MA_WINDOW)
        if not latest:
            return
        premium_pct = latest["premium_pct"]

        # 1) Automatic MA-deviation alerts (proposal: spikes/drops vs moving average)
        if ma is not None:
            deviation = premium_pct - ma
            if abs(deviation) >= PREMIUM_MA_DEVIATION_PCT:
                direction = "spike" if deviation > 0 else "drop"
                key = direction
                now = time.time()
                if now - _last_global_alert.get(key, 0) > COOLDOWN_SECONDS:
                    _last_global_alert[key] = now
                    message = (
                        f"P2P PKR premium {direction}ed to {premium_pct:.2f}% "
                        f"({deviation:+.2f} pts vs {PREMIUM_MA_WINDOW}-pt MA {ma:.2f}%)"
                    )
                    await self._emit(
                        "premium_ma",
                        message,
                        {
                            "premium_pct": premium_pct,
                            "ma": round(ma, 3),
                            "deviation": round(deviation, 3),
                            "p2p_rate": latest.get("p2p_rate"),
                            "interbank_rate": latest.get("interbank_rate"),
                            "direction": direction,
                        },
                    )

        # 2) User-defined absolute threshold rules
        now = time.time()
        for rule in db.enabled_alert_rules():
            if rule["user_id"] is None:
                continue
            fired_recently = rule.get("last_fired_at") and now - rule["last_fired_at"] < COOLDOWN_SECONDS
            if fired_recently:
                continue
            crossed = (
                (rule["direction"] == "above" and premium_pct >= rule["threshold"])
                or (rule["direction"] == "below" and premium_pct <= rule["threshold"])
            )
            if crossed:
                db.mark_alert_fired(rule["id"])
                await self._emit(
                    "threshold",
                    f"Premium is {premium_pct:.2f}% — crossed your {rule['direction']} "
                    f"{rule['threshold']:.2f}% threshold",
                    {
                        "premium_pct": premium_pct,
                        "threshold": rule["threshold"],
                        "direction": rule["direction"],
                        "p2p_rate": latest.get("p2p_rate"),
                    },
                    user_id=rule["user_id"],
                )

    async def evaluate_arbitrage(self):
        """Fire when the best cross-method round-trip margin clears the threshold."""
        state = get_p2p_state()
        if not state.get("ts"):
            return
        scan = scan_arbitrage(state, get_interbank_rate())
        margin_pct = best_arb_margin_pct(scan)
        if margin_pct is None or margin_pct < ARB_MARGIN_PCT:
            return
        now = time.time()
        if now - _last_global_alert.get("arbitrage", 0) < ARB_COOLDOWN_SECONDS:
            return
        _last_global_alert["arbitrage"] = now
        cross = scan["cross"]
        top = scan["rows"][0] if scan["rows"] else None
        message = (
            f"Arbitrage: round-trip margin {margin_pct:.2f}% "
            f"(buy @ {cross['best_buy']} / sell @ {cross['best_sell']} PKR)"
            + (f" · best method {top['method']} {top['margin']:+.2f} PKR" if top and top["margin"] is not None else "")
        )
        await self._emit(
            "arbitrage",
            message,
            {
                "margin_pct": margin_pct,
                "cross": cross,
                "top_method": top,
                "threshold_pct": ARB_MARGIN_PCT,
            },
        )

    async def evaluate_price_alerts(self):
        """Fire user price alerts when the live ticker crosses their level."""
        tickers = get_tickers()
        if not tickers:
            return
        now = time.time()
        for alert in db.list_enabled_price_alerts():
            ticker = tickers.get(alert["symbol"])
            if not ticker:
                continue
            price = ticker["price"]
            crossed = (
                (alert["direction"] == "up" and price >= alert["price"])
                or (alert["direction"] == "down" and price <= alert["price"])
            )
            if not crossed:
                continue
            fired_at = alert.get("last_fired_at")
            if fired_at and now - fired_at < PRICE_COOLDOWN_SECONDS:
                continue
            one_shot = bool(alert.get("one_shot"))
            db.mark_price_alert_fired(alert["id"], disable=one_shot)
            direction_txt = "rose above" if alert["direction"] == "up" else "dropped below"
            await self._emit(
                "price",
                f"{alert['symbol']} {direction_txt} {alert['price']}: now {price:,.2f} USDT",
                {
                    "symbol": alert["symbol"],
                    "direction": alert["direction"],
                    "target": alert["price"],
                    "price": price,
                    "one_shot": one_shot,
                },
                user_id=alert["user_id"],
            )

    async def _loop(self):
        while True:
            try:
                await self.evaluate()
            except Exception as exc:
                log.warning("alert evaluation failed: %s", exc)
            try:
                await self.evaluate_arbitrage()
            except Exception as exc:
                log.warning("arbitrage evaluation failed: %s", exc)
            await asyncio.sleep(30)

    async def _price_loop(self):
        while True:
            try:
                await self.evaluate_price_alerts()
            except Exception as exc:
                log.warning("price alert evaluation failed: %s", exc)
            await asyncio.sleep(PRICE_CHECK_SECONDS)

    async def start(self):
        self._task = asyncio.create_task(self._loop(), name="alert-engine")
        self._price_task = asyncio.create_task(self._price_loop(), name="price-alert-engine")

    async def stop(self):
        for task in (self._task, self._price_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass


alert_engine = AlertEngine()
