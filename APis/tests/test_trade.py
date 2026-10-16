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
