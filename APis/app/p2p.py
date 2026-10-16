"""P2P aggregator: live USDT/PKR rates, interbank FX, premium + spread analytics."""

import asyncio
import logging
import statistics
import time
from collections import deque

import httpx

from .cache import cache
from .config import (
    ARB_MARGIN_PCT,
    FX_REFRESH_SECONDS,
    HISTORY_MAX_POINTS,
    P2P_REFRESH_SECONDS,
    PREMIUM_MA_WINDOW,
)

log = logging.getLogger("rp.p2p")

P2P_URL = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search"
FX_SOURCES = [
    ("open.er-api.com", "https://open.er-api.com/v6/latest/USD"),
    ("exchangerate-api", "https://api.exchangerate-api.com/v4/latest/USD"),
]

TRACKED_METHODS = ["Easypaisa", "Raast", "Bank Transfer", "SadaPay", "NayaPay", "Upaisa"]

P2P_STATE_KEY = "p2p:state"
P2P_ADS_KEY = "p2p:ads"
FX_CACHE_KEY = "fx:usd_pkr"


def _method_key(name: str) -> str:
    lowered = name.lower()
    if "easypaisa" in lowered:
        return "Easypaisa"
    if "raast" in lowered:
        return "Raast"
    if "sada" in lowered:
        return "SadaPay"
    if "napay" in lowered or "nayapay" in lowered:
        return "NayaPay"
    if "upaisa" in lowered:
        return "Upaisa"
    if "bank" in lowered:
        return "Bank Transfer"
    return name


async def _search_ads(session: httpx.AsyncClient, trade_type: str, rows: int = 40) -> list[dict]:
    body = {
        "page": 1,
        "rows": rows,
        "payTypes": [],
        "coin": "USDT",
        "tradeType": trade_type,
        "fiat": "PKR",
        "merchantCheck": True,
        "proMerchantOnly": False,
        "shieldMerchantOnly": False,
        "publisherType": None,
        "searchMode": "price",
        "asset": "USDT",
    }
    resp = await session.post(
        P2P_URL,
        json=body,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) RupeePulse/1.0",
            "Referer": "https://p2p.binance.com/",
        },
        timeout=20.0,
    )
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("code") != "000000" or not payload.get("data"):
        raise RuntimeError(f"P2P search failed: {payload.get('message')}")
    return payload["data"]


def _robust_best(values: list[float], side: str) -> float | None:
    """Best executable price, clamped within 1.5% of the median to drop outlier ads."""
    if not values:
        return None
    med = statistics.median(values)
    if side == "buy":
        allowed = [v for v in values if v >= med * 0.985]
        return min(allowed) if allowed else min(values)
    allowed = [v for v in values if v <= med * 1.015]
    return max(allowed) if allowed else max(values)


def _summarize(ads: list[dict], side: str) -> dict:
    """Aggregate ads for one side.

    side='buy'  -> ads where the merchant SELLS USDT (user buys)  -> user pays `price`
    side='sell' -> ads where the merchant BUYS USDT (user sells)  -> user receives `price`
    """
    wanted = "SELL" if side == "buy" else "BUY"
    prices: list[float] = []
    by_method: dict[str, list[float]] = {}
    for ad in ads:
        adv = ad.get("adv") or {}
        if adv.get("tradeType") != wanted:
            continue
        try:
            price = float(adv["price"])
        except (KeyError, TypeError, ValueError):
            continue
        if price <= 0:
            continue
        prices.append(price)
        for method in adv.get("tradeMethods") or []:
            name = method.get("tradeMethodShortName") or method.get("tradeMethodName") or ""
            if not name:
                continue
            by_method.setdefault(_method_key(name), []).append(price)

    methods = {}
    for name, values in by_method.items():
        best = _robust_best(values, side)
        methods[name] = {
            "median": round(statistics.median(values), 2),
            "best": round(best, 2) if best else None,
            "count": len(values),
        }

    if not prices:
        return {"median": None, "best": None, "count": 0, "methods": methods}

    best = _robust_best(prices, side)
    return {
        "median": round(statistics.median(prices), 2),
        "best": round(best, 2) if best else None,
        "count": len(prices),
        "methods": methods,
    }


async def fetch_interbank_rate() -> float | None:
    cached = cache.get(FX_CACHE_KEY)
    if cached:
        return cached
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
        for name, url in FX_SOURCES:
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
                rate = data.get("rates", {}).get("PKR")
                if rate:
                    rate = float(rate)
                    cache.set(FX_CACHE_KEY, rate, ttl=FX_REFRESH_SECONDS)
                    log.info("interbank USD/PKR = %.4f via %s", rate, name)
                    return rate
            except Exception as exc:
                log.warning("FX source %s failed: %s", name, exc)
    return cache.get(FX_CACHE_KEY)


def _compact_ad(ad: dict, side: str) -> dict | None:
    """Trim one Binance P2P ad to the fields the ads table shows."""
    adv = ad.get("adv") or {}
    if adv.get("tradeType") != ("SELL" if side == "buy" else "BUY"):
        return None
    try:
        price = float(adv["price"])
    except (KeyError, TypeError, ValueError):
        return None
    if price <= 0:
        return None
    advertiser = ad.get("advertiser") or {}
    methods = []
    for method in adv.get("tradeMethods") or []:
        name = method.get("tradeMethodShortName") or method.get("tradeMethodName") or ""
        if name:
            methods.append(_method_key(name))
    try:
        completed = int(advertiser.get("monthOrderCount") or 0)
    except (TypeError, ValueError):
        completed = 0
    try:
        rate = float(advertiser.get("monthFinishRate") or 0)
    except (TypeError, ValueError):
        rate = 0.0
    try:
        min_amt = float(adv.get("minSingleTransAmount") or 0)
    except (TypeError, ValueError):
        min_amt = 0.0
    try:
        max_amt = float(adv.get("dynamicMaxSingleTransAmount") or adv.get("maxSingleTransAmount") or 0)
    except (TypeError, ValueError):
        max_amt = 0.0
    try:
        available = float(adv.get("surplusAmount") or adv.get("tradableQuantity") or 0)
    except (TypeError, ValueError):
        available = 0.0
    return {
        "side": side,
        "price": price,
        "methods": sorted(set(methods)),
        "min": min_amt,
        "max": max_amt,
        "available": round(available, 2),
        "monthly_orders": completed,
        "completion_rate": round(rate * 100, 1) if rate <= 1 else round(rate, 1),
        "merchant": (advertiser.get("nickName") or advertiser.get("userNo") or "merchant")[:32],
        "online": bool(advertiser.get("isOnline") or False),
    }


async def fetch_p2p_snapshot() -> dict:
    async with httpx.AsyncClient() as client:
        buy_ads, sell_ads = await asyncio.gather(
            _search_ads(client, "BUY"), _search_ads(client, "SELL")
        )
    # tradeType=BUY request -> merchant sells (user buys USDT)
    buy = _summarize(buy_ads, "buy")
    sell = _summarize(sell_ads, "sell")

    # Phase 2: cache trimmed raw ads for GET /api/p2p/ads
    compact = []
    for raw in buy_ads:
        row = _compact_ad(raw, "buy")
        if row:
            compact.append(row)
    for raw in sell_ads:
        row = _compact_ad(raw, "sell")
        if row:
            compact.append(row)
    compact.sort(key=lambda r: r["price"], reverse=False)
    cache.set(
        P2P_ADS_KEY,
        {"ts": time.time(), "count": len(compact), "ads": compact[:80]},
        ttl=P2P_REFRESH_SECONDS * 3,
    )

    methods: dict[str, dict] = {}
    for name in set(list(buy["methods"]) + list(sell["methods"]) + TRACKED_METHODS):
        entry = {}
        b = buy["methods"].get(name)
        s = sell["methods"].get(name)
        if b:
            entry["buy"] = b
        if s:
            entry["sell"] = s
        if entry:
            methods[name] = entry

    snapshot = {
        "ts": time.time(),
        "buy": buy,
        "sell": sell,
        "methods": methods,
        "spread": round(sell["best"] - buy["best"], 2)
        if buy["best"] and sell["best"]
        else None,
        "source": "binance-p2p",
    }
    cache.set(P2P_STATE_KEY, snapshot, ttl=P2P_REFRESH_SECONDS * 3)
    return snapshot


def get_p2p_state() -> dict:
    return cache.get(P2P_STATE_KEY) or {
        "ts": 0,
        "buy": {"median": None, "best": None, "count": 0, "methods": {}},
        "sell": {"median": None, "best": None, "count": 0, "methods": {}},
        "methods": {},
        "spread": None,
        "source": "pending",
    }


def get_interbank_rate() -> float | None:
    return cache.get(FX_CACHE_KEY)


def get_ads() -> dict:
    return cache.get(P2P_ADS_KEY) or {"ts": 0, "count": 0, "ads": []}


def compute_premium(p2p_state: dict, interbank: float | None) -> dict | None:
    buy_best = (p2p_state.get("buy") or {}).get("best")
    if not buy_best or not interbank:
        return None
    return {
        "p2p_rate": buy_best,
        "interbank_rate": round(interbank, 4),
        "premium_pct": round((buy_best - interbank) / interbank * 100, 3),
        "delta": round(buy_best - interbank, 3),
    }


class PremiumHistory:
    """Rolling premium series feeding moving-average arbitrage alerts.

    Points are persisted to SQLite so the chart and MA survive restarts.
    """

    def __init__(self, max_points: int = HISTORY_MAX_POINTS):
        self.points: deque[dict] = deque(maxlen=max_points)
        self._loaded = False

    def load(self):
        """Hydrate from the database once at startup (oldest first)."""
        if self._loaded:
            return
        self._loaded = True
        try:
            from . import db

            rows = db.recent_premium_samples(self.maxlen)
            for row in rows:
                self.points.append(row)
            if rows:
                log.info("premium history restored: %d samples", len(rows))
        except Exception as exc:
            log.warning("premium history restore failed: %s", exc)

    @property
    def maxlen(self) -> int:
        return self.points.maxlen or HISTORY_MAX_POINTS

    def push(self, premium: dict):
        self.points.append({"ts": time.time(), **premium})
        try:
            from . import db

            db.insert_premium_sample(premium)
        except Exception as exc:
            log.debug("premium sample persist failed: %s", exc)

    def series(self) -> list[dict]:
        return list(self.points)

    def moving_average(self, window: int = PREMIUM_MA_WINDOW) -> float | None:
        recent = list(self.points)[-window:]
        if len(recent) < max(3, window // 3):
            return None
        return statistics.fmean(p["premium_pct"] for p in recent)

    def latest(self) -> dict | None:
        return self.points[-1] if self.points else None


premium_history = PremiumHistory()


class P2PAggregator:
    """Periodic fetch loop: P2P ads + interbank FX -> premium history -> subscribers."""

    def __init__(self):
        self._task: asyncio.Task | None = None
        self._subscribers: list = []
        self.last_error: str | None = None

    def subscribe(self, callback):
        self._subscribers.append(callback)

    def unsubscribe(self, callback):
        if callback in self._subscribers:
            self._subscribers.remove(callback)

    async def start(self):
        self._task = asyncio.create_task(self._loop(), name="p2p-aggregator")

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def refresh_once(self) -> dict:
        p2p_state, interbank = await asyncio.gather(
            fetch_p2p_snapshot(), fetch_interbank_rate()
        )
        premium = compute_premium(p2p_state, interbank)
        if premium:
            premium_history.push(premium)
        payload = {
            "type": "p2p",
            "data": {
                "p2p": p2p_state,
                "interbank": interbank,
                "premium": premium,
                "ma": premium_history.moving_average(),
            },
        }
        self.last_error = None
        for callback in list(self._subscribers):
            try:
                await callback(payload)
            except Exception as exc:
                log.debug("p2p broadcast failed: %s", exc)
        return payload["data"]

    async def _loop(self):
        # First refresh immediately, then on the configured cadence.
        while True:
            started = time.monotonic()
            try:
                await self.refresh_once()
            except Exception as exc:
                self.last_error = str(exc)
                log.warning("p2p refresh failed: %s", exc)
            elapsed = time.monotonic() - started
            await asyncio.sleep(max(5.0, P2P_REFRESH_SECONDS - elapsed))


aggregator = P2PAggregator()


def get_analytics() -> dict:
    p2p_state = get_p2p_state()
    interbank = get_interbank_rate()
    premium = compute_premium(p2p_state, interbank)
    history = premium_history.series()
    ma = premium_history.moving_average()
    method_rows = []
    for name, entry in sorted(p2p_state.get("methods", {}).items()):
        buy = (entry.get("buy") or {}).get("median")
        sell = (entry.get("sell") or {}).get("median")
        row = {"method": name, "buy": buy, "sell": sell}
        if buy and interbank:
            row["premium_pct"] = round((buy - interbank) / interbank * 100, 3)
        method_rows.append(row)
    return {
        "premium": premium,
        "ma": ma,
        "interbank": interbank,
        "history": history,
        "methods": method_rows,
        "spread": p2p_state.get("spread"),
        "ts": p2p_state.get("ts"),
    }


# ---------------------------------------------------------------- arbitrage scanner


def scan_arbitrage(p2p_state: dict, interbank: float | None) -> dict:
    """Rank payment methods by round-trip USDT margin (buy → sell) in PKR.

    `buy` = best price to acquire USDT on that method, `sell` = best price to
    liquidate it there. margin = sell - buy; positive means a same-method
    round trip is profitable before any external costs.
    """
    methods = p2p_state.get("methods") or {}
    rows: list[dict] = []
    for name, entry in methods.items():
        buy = (entry.get("buy") or {}).get("best")
        sell = (entry.get("sell") or {}).get("best")
        row = {"method": name, "buy": buy, "sell": sell, "margin": None, "margin_pct": None}
        if buy and sell:
            margin = round(sell - buy, 2)
            row["margin"] = margin
            row["margin_pct"] = round(margin / buy * 100, 3) if buy else None
        if buy and interbank:
            row["premium_pct"] = round((buy - interbank) / interbank * 100, 3)
        rows.append(row)

    rows.sort(
        key=lambda r: r["margin"] if r["margin"] is not None else -1e9,
        reverse=True,
    )

    buy_prices = [r["buy"] for r in rows if r["buy"]]
    sell_prices = [r["sell"] for r in rows if r["sell"]]
    best_buy = min(buy_prices) if buy_prices else None
    best_sell = max(sell_prices) if sell_prices else None
    cross_margin = (
        round(best_sell - best_buy, 2) if best_buy and best_sell else None
    )
    opportunities = [
        r for r in rows
        if r["margin_pct"] is not None and r["margin_pct"] >= ARB_MARGIN_PCT
    ]
    return {
        "ts": p2p_state.get("ts"),
        "interbank": interbank,
        "arb_threshold_pct": ARB_MARGIN_PCT,
        "rows": rows,
        "opportunities": opportunities,
        "cross": {
            "best_buy": best_buy,
            "best_sell": best_sell,
            "margin": cross_margin,
            "margin_pct": round(cross_margin / best_buy * 100, 3)
            if cross_margin is not None and best_buy
            else None,
        },
        "source": p2p_state.get("source"),
    }


def best_arb_margin_pct(scan: dict) -> float | None:
    m = scan.get("cross", {}).get("margin_pct")
    if m is not None:
        return m
    if scan["rows"] and scan["rows"][0]["margin_pct"] is not None:
        return scan["rows"][0]["margin_pct"]
    return None
