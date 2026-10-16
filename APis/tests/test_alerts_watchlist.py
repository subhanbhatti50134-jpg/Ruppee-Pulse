def test_price_alert_crud(client, user):
    c = user["client"]
    assert c.get("/api/price-alerts").status_code == 200

    created = c.post(
        "/api/price-alerts",
        json={"symbol": "btc", "direction": "up", "price": 111000, "one_shot": True},
    )
    assert created.status_code == 200, created.text
    alert = created.json()["alert"]
    assert alert["symbol"] == "BTCUSDT"  # normalized
    assert alert["enabled"] == 1

    listed = c.get("/api/price-alerts").json()["alerts"]
    assert any(a["id"] == alert["id"] for a in listed)

    toggled = c.post(f"/api/price-alerts/{alert['id']}/toggle").json()["alert"]
    assert toggled["enabled"] == 0

    assert c.delete(f"/api/price-alerts/{alert['id']}").status_code == 200
    assert c.delete(f"/api/price-alerts/{alert['id']}").status_code == 404


def test_price_alert_requires_auth(client):
    res = client.post(
        "/api/price-alerts",
        json={"symbol": "BTCUSDT", "direction": "up", "price": 100},
    )
    assert res.status_code == 401


def test_watchlist_crud(client, user):
    c = user["client"]
    added = c.post("/api/watchlist", json={"symbol": "sol"})
    assert added.status_code == 200
    assert "SOLUSDT" in added.json()["symbols"]

    listed = c.get("/api/watchlist").json()["symbols"]
    assert "SOLUSDT" in listed

    removed = c.delete("/api/watchlist/SOLUSDT").json()["symbols"]
    assert "SOLUSDT" not in removed


def test_alert_rules_crud(client, user):
    c = user["client"]
    created = c.post("/api/alerts", json={"direction": "above", "threshold": 123456})
    assert created.status_code == 200
    rule_id = created.json()["rule"]["id"]

    body = c.get("/api/alerts").json()
    assert any(r["id"] == rule_id for r in body["rules"])
    assert "events" in body

    assert c.delete(f"/api/alerts/{rule_id}").status_code == 200
    assert c.delete(f"/api/alerts/{rule_id}").status_code == 404
