from pathlib import Path

import pytest

DIST = Path(__file__).resolve().parent.parent.parent / "ui" / "dist"

pytestmark = pytest.mark.skipif(not (DIST / "index.html").is_file(), reason="ui/dist not built")


def test_spa_root_serves_index(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert '<div id="root">' in res.text


def test_spa_fallback_for_client_routes(client):
    res = client.get("/trade")
    assert res.status_code == 200
    assert '<div id="root">' in res.text


def test_spa_does_not_shadow_api(client):
    res = client.get("/api/definitely-not-a-route")
    assert res.status_code == 404
    assert res.headers["content-type"].startswith("application/json")


def test_spa_does_not_shadow_ws(client):
    assert client.get("/ws").status_code == 404


def test_assets_served_directly(client):
    assets = sorted((DIST / "assets").glob("index-*.js"))
    if not assets:
        pytest.skip("no hashed assets")
    res = client.get(f"/assets/{assets[0].name}")
    assert res.status_code == 200
    assert "javascript" in res.headers["content-type"]


def test_api_health_still_reachable(client):
    assert client.get("/api/health").status_code == 200
