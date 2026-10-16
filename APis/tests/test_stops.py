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
