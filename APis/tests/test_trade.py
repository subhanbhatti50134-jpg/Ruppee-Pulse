from conftest import _ticker  # noqa: E402  (env already set at conftest import)


def test_market_buy_fills_and_moves_balances(client, user, tickers, pkr_rate):
    c = user["client"]
    res = c.post(
        "/api/trade/order",
        json={"symbol": "ETHUSDT", "side": "BUY", "type": "MARKET", "quote_quantity": 4000, "mode": "demo"},
    )
    assert res.status_code == 200, res.text
    order = res.json()["order"]
    assert order["status"] == "FILLED"
    assert order["avg_price"] == 2000.0
    assert order["quantity"] == 2.0

    bal = c.get("/api/trade/balances").json()
    by_asset = {b["asset"]: b for b in bal["balances"]}
    assert by_asset["USDT"]["free"] < 100_000
    assert by_asset["ETH"]["free"] == 2.0
    assert bal["total_usd"] > 0


def test_insufficient_funds_is_400(client, user, tickers, pkr_rate):
    res = user["client"].post(
        "/api/trade/order",
        json={"symbol": "BTCUSDT", "side": "BUY", "type": "MARKET", "quote_quantity": 10**9, "mode": "demo"},
    )
    assert res.status_code == 400
    assert "Insufficient" in res.json()["detail"]


def test_portfolio_avg_cost_realized_and_allocation(client, user, tickers, pkr_rate):
    c = user["client"]
    assert c.post(
        "/api/trade/order",
        json={"symbol": "ETHUSDT", "side": "BUY", "type": "MARKET", "quote_quantity": 6000, "mode": "demo"},
    ).status_code == 200

    # price rises: 2000 -> 2100, then sell one ETH -> realized gain
    tickers["ETHUSDT"] = _ticker("ETHUSDT", 2100.0)
    from app.binance_stream import TICKER_CACHE_KEY
    from app.cache import cache

    cache.set(TICKER_CACHE_KEY, tickers, ttl=120)
    assert c.post(
        "/api/trade/order",
        json={"symbol": "ETHUSDT", "side": "SELL", "type": "MARKET", "quantity": 1, "mode": "demo"},
    ).status_code == 200

    port = c.get("/api/trade/portfolio").json()
    eth = next(p for p in port["positions"] if p["asset"] == "ETH")
    assert eth["qty"] == 2.0
    assert eth["avg_cost"] == 2000.0
    assert eth["realized_pnl"] == 100.0  # (2100 - 2000) * 1
    assert eth["unrealized_pnl"] == 200.0  # (2100 - 2000) * 2
    assert port["realized_pnl"] == 100.0
    assert port["unrealized_pnl"] == 200.0
    assert port["total_pnl"] == 300.0

    total_weight = sum(a["weight_pct"] for a in port["allocation"])
    assert 99.0 <= total_weight <= 101.0


def test_history_attributes_realized_pnl_per_trade(client, user, tickers, pkr_rate):
    c = user["client"]
    from app.binance_stream import TICKER_CACHE_KEY
    from app.cache import cache

    # buy 2 ETH @ 2000 (seeded ticker), then realize one win and one loss
    assert c.post(
        "/api/trade/order",
        json={"symbol": "ETHUSDT", "side": "BUY", "type": "MARKET", "quantity": 2, "mode": "demo"},
    ).status_code == 200
    tickers["ETHUSDT"] = _ticker("ETHUSDT", 2100.0)
    cache.set(TICKER_CACHE_KEY, tickers, ttl=120)
    assert c.post(
        "/api/trade/order",
        json={"symbol": "ETHUSDT", "side": "SELL", "type": "MARKET", "quantity": 1, "mode": "demo"},
    ).status_code == 200
    tickers["ETHUSDT"] = _ticker("ETHUSDT", 1900.0)
    cache.set(TICKER_CACHE_KEY, tickers, ttl=120)
    assert c.post(
        "/api/trade/order",
        json={"symbol": "ETHUSDT", "side": "SELL", "type": "MARKET", "quantity": 1, "mode": "demo"},
    ).status_code == 200

    hist = c.get("/api/trade/history").json()["orders"]
    sells = sorted(o["pnl"] for o in hist if o["side"] == "SELL")
    assert sells == [-100.0, 100.0]
    assert all(o["pnl"] is None for o in hist if o["side"] == "BUY")

    # per-trade P&L sums to the portfolio's realized total
    port = c.get("/api/trade/portfolio").json()
    assert port["realized_pnl"] == sum(o["pnl"] for o in hist if o["pnl"] is not None)


def test_keys_connection_test(client, user, tickers, pkr_rate, monkeypatch):
    c = user["client"]
    # before keys exist -> clear 400
    assert c.post("/api/trade/keys/test").status_code == 400

    res = c.post("/api/trade/keys", json={"api_key": "k" * 24, "api_secret": "s" * 24})
    assert res.status_code == 200

    import app.trade as trade_mod

    async def fake_signed(api_key, api_secret, method, path, params=None):
        assert path == "/api/v3/account"  # read-only check, never an order
        return {
            "canTrade": True,
            "canWithdraw": False,
            "canDeposit": True,
            "permissions": ["SPOT"],
            "balances": [
                {"asset": "USDT", "free": "100.0", "locked": "0"},
                {"asset": "BTC", "free": "0", "locked": "0"},
            ],
        }

    monkeypatch.setattr(trade_mod, "signed_request", fake_signed)
    res = c.post("/api/trade/keys/test")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["can_trade"] is True
    assert body["can_withdraw"] is False
    assert body["permissions"] == ["SPOT"]
    assert body["nonzero_balances"] == 1

    # a Binance-side rejection surfaces as a 400 with the error text
    from app.binance_stream import BinanceAPIError

    async def reject(*args, **kwargs):
        raise BinanceAPIError(-2015, "Invalid API-key, IP, or permissions")

    monkeypatch.setattr(trade_mod, "signed_request", reject)
    res = c.post("/api/trade/keys/test")
    assert res.status_code == 400
    assert "-2015" in res.json()["detail"]


def test_equity_curve_replays_trades(client, user, tickers, pkr_rate):
    c = user["client"]
    from app.binance_stream import TICKER_CACHE_KEY
    from app.cache import cache

    # fresh demo account: single live point, no growth yet
    eq = c.get("/api/trade/equity").json()
    assert eq["current_equity"] == 100_000.0
    assert len(eq["points"]) == 1
    assert eq["change"] == 0

    # buy 2 ETH @ 2000 (equity unchanged at fill valuation)
    assert c.post(
        "/api/trade/order",
        json={"symbol": "ETHUSDT", "side": "BUY", "type": "MARKET", "quantity": 2, "mode": "demo"},
    ).status_code == 200
    # price rises to 2100 -> sell one (realizes +100)
    tickers["ETHUSDT"] = _ticker("ETHUSDT", 2100.0)
    cache.set(TICKER_CACHE_KEY, tickers, ttl=120)
    assert c.post(
        "/api/trade/order",
        json={"symbol": "ETHUSDT", "side": "SELL", "type": "MARKET", "quantity": 1, "mode": "demo"},
    ).status_code == 200
    # price eases to 2050 -> final live mark differs from the last fill point
    tickers["ETHUSDT"] = _ticker("ETHUSDT", 2050.0)
    cache.set(TICKER_CACHE_KEY, tickers, ttl=120)

    eq = c.get("/api/trade/equity").json()
    assert eq["points"][0]["equity"] == 100_000.0  # post-buy, valued at fill
    assert eq["points"][1]["equity"] == 100_200.0  # cash 98_100 + 1 ETH @ 2100
    assert eq["points"][2]["equity"] == 100_150.0  # live mark: 98_100 + 1 ETH @ 2050
    assert eq["current_equity"] == 100_150.0
    assert eq["change"] == 150.0
    assert eq["realized_pnl"] == 100.0
    assert ts_strictly_increasing(eq["points"])


def ts_strictly_increasing(points):
    ts = [p["ts"] for p in points]
    return all(b > a for a, b in zip(ts, ts[1:], strict=False))


def test_order_history_and_reset(client, user, tickers, pkr_rate):
    c = user["client"]
    c.post(
        "/api/trade/order",
        json={"symbol": "SOLUSDT", "side": "BUY", "type": "MARKET", "quantity": 5, "mode": "demo"},
    )
    hist = c.get("/api/trade/history").json()
    assert len(hist["orders"]) >= 1
    assert hist["orders"][0]["symbol"] == "SOLUSDT"

    reset = c.post("/api/trade/demo/reset")
    assert reset.status_code == 200
    balances = reset.json()["balances"]
    assert balances["USDT"]["free"] == 100_000
    # demo orders wiped by the reset
    assert c.get("/api/trade/history").json()["orders"] == []


def test_orders_require_auth(client, tickers):
    res = client.post(
        "/api/trade/order",
        json={"symbol": "ETHUSDT", "side": "BUY", "type": "MARKET", "quantity": 1, "mode": "demo"},
    )
    assert res.status_code == 401
