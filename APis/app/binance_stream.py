"""Binance spot market data: REST helpers, signed private calls, live WebSocket stream."""

import asyncio
import hashlib
import hmac
import json
import logging
import time
import urllib.parse
from collections.abc import Awaitable, Callable

import httpx
import websockets

from .cache import cache
from .config import WATCHED_SYMBOLS

log = logging.getLogger("rp.binance")

REST_BASE = "https://api.binance.com"
WS_BASE = "wss://stream.binance.com:9443"

TICKER_CACHE_KEY = "spot:tickers"


def klines_cache_key(symbol: str, interval: str, limit: int) -> str:
    return f"klines:{symbol}:{interval}:{limit}"


async def rest_get(path: str, params: dict | None = None, timeout: float = 10.0) -> dict | list:
    async with httpx.AsyncClient(base_url=REST_BASE, timeout=timeout) as client:
        resp = await client.get(path, params=params or {})
        resp.raise_for_status()
        return resp.json()


async def signed_request(
    api_key: str, api_secret: str, method: str, path: str, params: dict | None = None
) -> dict | list:
    """Perform a signed Binance API request (HMAC-SHA256)."""
    query = dict(params or {})
    query["timestamp"] = int(time.time() * 1000)
    query["recvWindow"] = 5000
    encoded = urllib.parse.urlencode(query)
    signature = hmac.new(api_secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
    url = f"{path}?{encoded}&signature={signature}"
    headers = {"X-MBX-APIKEY": api_key}
    async with httpx.AsyncClient(base_url=REST_BASE, timeout=15.0) as client:
        resp = await client.request(method, url, headers=headers)
        body = resp.json()
        if resp.status_code >= 400:
            code = body.get("code", resp.status_code)
            msg = body.get("msg", "Binance request failed")
            raise BinanceAPIError(code, msg)
        return body


class BinanceAPIError(Exception):
    def __init__(self, code, message):
        super().__init__(f"Binance error {code}: {message}")
        self.code = code
        self.message = message


async def fetch_ticker_snapshot(symbols: list[str]) -> dict[str, dict]:
    wanted = {f"{s}USDT" for s in symbols}
    data = await rest_get("/api/v3/ticker/24hr")
    out = {}
    for item in data:
        if item["symbol"] in wanted:
            out[item["symbol"]] = {
                "symbol": item["symbol"],
                "price": float(item["lastPrice"]),
                "open": float(item["openPrice"]),
                "high": float(item["highPrice"]),
                "low": float(item["lowPrice"]),
                "volume": float(item["volume"]),
                "quoteVolume": float(item["quoteVolume"]),
                "change_pct": float(item["priceChangePercent"]),
                "change": float(item["priceChange"]),
                "ts": int(item["closeTime"]),
            }
    cache.set(TICKER_CACHE_KEY, out, ttl=30)
    return out


def get_tickers() -> dict[str, dict]:
    return cache.get(TICKER_CACHE_KEY, {}) or {}


def get_price(symbol: str) -> float | None:
    ticker = get_tickers().get(symbol)
    if ticker:
        return ticker["price"]
    cached = cache.get(klines_cache_key(symbol, "1m", 2))
    if cached:
        return float(cached[-1][4])
    return None


async def fetch_klines(symbol: str, interval: str, limit: int = 200) -> list:
    """Candles for lightweight-charts. Cached briefly so chart polling stays polite."""
    key = klines_cache_key(symbol, interval, limit)
    cached = cache.get(key)
    if cached is not None:
        return cached
    raw = await rest_get(
        "/api/v3/klines", {"symbol": symbol, "interval": interval, "limit": limit}
    )
    candles = [
        {
            "time": int(k[0] // 1000),
            "open": float(k[1]),
            "high": float(k[2]),
            "low": float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5]),
        }
        for k in raw
    ]
    # Freshness: older candles never change, only the forming one does.
    if candles:
        age = time.time() - candles[-1]["time"]
        ttl = max(2.0, 60.0 - age) if limit < 500 else 120.0
    else:
        ttl = 30.0
    cache.set(key, candles, ttl=ttl)
    return candles


class SpotStream:
    """Maintains live spot tickers for the watched symbol list and fans them out."""

    def __init__(self, symbols: list[str] | None = None):
        self.symbols = symbols or WATCHED_SYMBOLS
        self.tickers: dict[str, dict] = {}
        self.connected = False
        self._subscribers: list[Callable[[dict], Awaitable[None]]] = []
        self._task: asyncio.Task | None = None
        self._last_broadcast = 0.0
        self._dirty = False

    def subscribe(self, callback: Callable[[dict], Awaitable[None]]):
        self._subscribers.append(callback)

    def unsubscribe(self, callback: Callable[[dict], Awaitable[None]]):
        if callback in self._subscribers:
            self._subscribers.remove(callback)

    async def start(self):
        try:
            snapshot = await fetch_ticker_snapshot(self.symbols)
            self.tickers.update(snapshot)
        except Exception as exc:
            log.warning("ticker snapshot failed: %s", exc)
        self._task = asyncio.create_task(self._run(), name="binance-spot-stream")

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self.connected = False

    def _stream_url(self) -> str:
        streams = "/".join(f"{s.lower()}usdt@ticker" for s in self.symbols)
        return f"{ws_base_url()}/stream?streams={streams}"

    async def _run(self):
        backoff = 1.0
        while True:
            try:
                async with websockets.connect(
                    self._stream_url(), open_timeout=15, ping_interval=20, ping_timeout=20
                ) as ws:
                    self.connected = True
                    backoff = 1.0
                    log.info("spot stream connected (%d symbols)", len(self.symbols))
                    await self._broadcast({"type": "status", "connected": True})
                    async for raw in ws:
                        self._handle_message(raw)
                        await self._maybe_broadcast()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.connected = False
                log.warning("spot stream error: %s (reconnecting in %.0fs)", exc, backoff)
                await self._broadcast({"type": "status", "connected": False})
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    def _handle_message(self, raw: str | bytes):
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return
        data = payload.get("data")
        if not isinstance(data, dict) or "s" not in data:
            return
        symbol = data["s"]
        if not symbol.endswith("USDT"):
            return
        self.tickers[symbol] = {
            "symbol": symbol,
            "price": float(data.get("c", 0)),
            "open": float(data.get("o", 0)),
            "high": float(data.get("h", 0)),
            "low": float(data.get("l", 0)),
            "volume": float(data.get("v", 0)),
            "quoteVolume": float(data.get("q", 0)),
            "change_pct": float(data.get("P", 0)),
            "change": float(data.get("p", 0)),
            "ts": int(data.get("E", time.time() * 1000)),
        }
        self._dirty = True
        cache.set(TICKER_CACHE_KEY, dict(self.tickers), ttl=60)

    async def _maybe_broadcast(self, interval: float = 1.0):
        now = time.monotonic()
        if self._dirty and now - self._last_broadcast >= interval:
            self._dirty = False
            self._last_broadcast = now
            await self._broadcast({"type": "tickers", "data": dict(self.tickers)})

    async def _broadcast(self, message: dict):
        for callback in list(self._subscribers):
            try:
                await callback(message)
            except Exception as exc:
                log.debug("broadcast failed: %s", exc)


def ws_base_url() -> str:
    return WS_BASE


stream = SpotStream()
