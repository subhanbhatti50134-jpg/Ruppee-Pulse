import asyncio

import pytest

from app import stops as stop_engine


@pytest.mark.parametrize(
    "side,kind,price,trigger,expected",
    [
        ("SELL", "STOP_LOSS", 95, 100, True),   # price fell to trigger
        ("SELL", "STOP_LOSS", 105, 100, False),
        ("SELL", "TAKE_PROFIT", 105, 100, True),  # price rose to target
        ("SELL", "TAKE_PROFIT", 95, 100, False),
        ("BUY", "STOP_LOSS", 105, 100, True),   # short squeezed to trigger
        ("BUY", "STOP_LOSS", 95, 100, False),
        ("BUY", "TAKE_PROFIT", 95, 100, True),  # price fell to target
        ("BUY", "TAKE_PROFIT", 105, 100, False),
    ],
)
def test_should_trigger_matrix(side, kind, price, trigger, expected):
    stop = {"side": side, "kind": kind, "trigger_price": trigger}
    assert stop_engine.should_trigger(stop, price) is expected


def test_stops_crud(client, user, tickers):
    c = user["client"]
    assert c.get("/api/stops").status_code == 200

    created = c.post(
        "/api/stops",
        json={
            "symbol": "SOL",
            "side": "SELL",
            "kind": "STOP_LOSS",
            "trigger_price": 1,       # never crosses spot 100
            "quantity": 0.5,
            "mode": "demo",
        },
    )
    assert created.status_code == 200, created.text
    stop = created.json()["stop"]
    assert stop["symbol"] == "SOLUSDT"  # suffix normalized
    assert stop["status"] == "PENDING"

    listed = c.get("/api/stops").json()
    assert listed["pending_count"] >= 1
    assert any(s["id"] == stop["id"] for s in listed["stops"])

    no_qty = c.post(
        "/api/stops",
        json={"symbol": "SOLUSDT", "side": "SELL", "kind": "STOP_LOSS", "trigger_price": 1},
    )
    assert no_qty.status_code == 400

    assert c.delete(f"/api/stops/{stop['id']}").status_code == 200
    assert c.delete(f"/api/stops/{stop['id']}").status_code == 404


def test_stops_require_auth(client, tickers):
    res = client.post(
        "/api/stops",
        json={"symbol": "SOLUSDT", "side": "SELL", "kind": "STOP_LOSS", "trigger_price": 1, "quantity": 1},
    )
    assert res.status_code == 401


def test_engine_fires_pending_stop(client, user, tickers, pkr_rate):
    c = user["client"]
    # hold SOL so the exit can fill
    assert c.post(
        "/api/trade/order",
        json={"symbol": "SOLUSDT", "side": "BUY", "type": "MARKET", "quote_quantity": 5000, "mode": "demo"},
    ).status_code == 200

    # SELL TAKE_PROFIT fires when price >= trigger; spot is 100
    created = c.post(
        "/api/stops",
        json={
            "symbol": "SOLUSDT",
            "side": "SELL",
            "kind": "TAKE_PROFIT",
            "trigger_price": 95,
            "quantity": 5,
            "mode": "demo",
        },
    )
    stop_id = created.json()["stop"]["id"]

    fired = asyncio.run(stop_engine.process_pending_stops())
    assert fired >= 1

    stops = c.get("/api/stops").json()["stops"]
    stop = next(s for s in stops if s["id"] == stop_id)
    assert stop["status"] == "FILLED"
    assert stop["linked_order_id"]

    events = c.get("/api/alerts").json()["events"]
    assert any(e["kind"] == "stop" and stop_id in str(e.get("payload", "")) for e in events)


def test_engine_failure_path(client, user, tickers, pkr_rate):
    c = user["client"]
    # no BTC held -> stop should fail cleanly and stay marked FAILED
    created = c.post(
        "/api/stops",
        json={
            "symbol": "BTCUSDT",
            "side": "SELL",
            "kind": "TAKE_PROFIT",
            "trigger_price": 1,
            "quantity": 0.5,
            "mode": "demo",
        },
    )
    stop_id = created.json()["stop"]["id"]
    asyncio.run(stop_engine.process_pending_stops())

    stops = c.get("/api/stops").json()["stops"]
    stop = next(s for s in stops if s["id"] == stop_id)
    assert stop["status"] == "FAILED"
    assert "Insufficient" in stop["error"]


def test_oco_pair_cancels_sibling_on_trigger(client, user, tickers, pkr_rate):
    c = user["client"]
    assert c.post(
        "/api/trade/order",
        json={"symbol": "SOLUSDT", "side": "BUY", "type": "MARKET", "quote_quantity": 5000, "mode": "demo"},
    ).status_code == 200

    # TP at 95 fires immediately (spot 100); SL at 90 must be auto-canceled
    res = c.post(
        "/api/stops",
        json={
            "symbol": "SOLUSDT",
            "side": "SELL",
            "kind": "TAKE_PROFIT",
            "trigger_price": 95,
            "oco_trigger_price": 90,
            "quantity": 5,
            "mode": "demo",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    group = body["group_id"]
    assert group
    assert len(body["stops"]) == 2
    assert {s["kind"] for s in body["stops"]} == {"TAKE_PROFIT", "STOP_LOSS"}
    assert all(s["group_id"] == group for s in body["stops"])

    fired = asyncio.run(stop_engine.process_pending_stops())
    assert fired >= 1

    listed = {s["id"]: s for s in c.get("/api/stops").json()["stops"]}
    legs = [s for s in listed.values() if s["group_id"] == group]
    tp = next(s for s in legs if s["kind"] == "TAKE_PROFIT")
    sl = next(s for s in legs if s["kind"] == "STOP_LOSS")
    assert tp["status"] == "FILLED"
    assert tp["linked_order_id"]
    assert sl["status"] == "CANCELED"
    assert "OCO" in (sl["error"] or "")

    # firing the pair again must be a no-op (nothing pending left in the group)
    assert asyncio.run(stop_engine.process_pending_stops()) == 0


def test_stop_limit_fires_as_limit_order(client, user, tickers, pkr_rate):
    from app import trade as trade_mod

    c = user["client"]
    assert c.post(
        "/api/trade/order",
        json={"symbol": "SOLUSDT", "side": "BUY", "type": "MARKET", "quote_quantity": 5000, "mode": "demo"},
    ).status_code == 200

    res = c.post(
        "/api/stops",
        json={
            "symbol": "SOLUSDT",
            "side": "SELL",
            "kind": "TAKE_PROFIT",
            "trigger_price": 95,      # spot 100 -> fires
            "quantity": 5,
            "mode": "demo",
            "order_type": "LIMIT",
            "limit_price": 99.5,
        },
    )
    assert res.status_code == 200, res.text
    stop_id = res.json()["stop"]["id"]
    assert res.json()["stop"]["order_type"] == "LIMIT"

    # LIMIT execution requires a limit price
    bad = c.post(
        "/api/stops",
        json={
            "symbol": "SOLUSDT", "side": "SELL", "kind": "TAKE_PROFIT",
            "trigger_price": 95, "quantity": 1, "mode": "demo", "order_type": "LIMIT",
        },
    )
    assert bad.status_code == 400

    assert asyncio.run(stop_engine.process_pending_stops()) >= 1
    stop = next(s for s in c.get("/api/stops").json()["stops"] if s["id"] == stop_id)
    assert stop["status"] == "FILLED"
    assert stop["linked_order_id"]

    # resting limit gets crossed by the market-crossing loop
    asyncio.run(trade_mod.process_demo_fills())
    order = next(
        o for o in c.get("/api/trade/history").json()["orders"] if o["id"] == stop["linked_order_id"]
    )
    assert order["type"] == "LIMIT"
    assert order["price"] == 99.5
    assert order["status"] == "FILLED"
    assert order["avg_price"] == 99.5
