def test_tickers_shape(client, tickers):
    res = client.get("/api/market/tickers")
    assert res.status_code == 200
    body = res.json()
    btc = body["data"]["BTCUSDT"]
    assert btc["price"] == 100_000.0
    assert btc["price_pkr"] > 0
    assert "BTCUSDT" in body["symbols"]
    assert "interbank" in body


def test_depth_normalizes_and_caches(client, monkeypatch):
    calls = []

    async def fake_rest_get(path, params=None, timeout=None):
        calls.append((path, params))
        return {
            "lastUpdateId": 42,
            "bids": [["100.0", "1.5"], ["99.5", "2.0"]],
            "asks": [["100.5", "0.75"]],
        }

    monkeypatch.setattr("app.routers.market.rest_get", fake_rest_get)
    # unique limit avoids colliding with any cached depth from other runs
    res = client.get("/api/market/depth?symbol=btcusdt&limit=7")
    assert res.status_code == 200
    body = res.json()
    assert body["symbol"] == "BTCUSDT"
    assert body["bids"][0] == {"price": 100.0, "qty": 1.5}
    assert body["asks"][0] == {"price": 100.5, "qty": 0.75}
    assert body["spread"] == 0.5
    assert len(calls) == 1

    again = client.get("/api/market/depth?symbol=BTCUSDT&limit=7")
    assert again.status_code == 200
    assert len(calls) == 1  # served from 2s cache


def test_klines_rejects_bad_interval(client):
    res = client.get("/api/market/klines?symbol=BTCUSDT&interval=2h")
    assert res.status_code == 422
