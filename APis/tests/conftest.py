"""Test bootstrap: isolate DB/key material before any app import, skip lifespans."""

import os
import shutil
import tempfile
import uuid

_TMP = tempfile.mkdtemp(prefix="rp_test_")
os.environ["RP_DB_PATH"] = os.path.join(_TMP, "test.db")
os.environ["RP_MASTER_KEY"] = "rp-test-master-key"
os.environ["RP_TELEGRAM_BOT_TOKEN"] = ""
os.environ["RP_TELEGRAM_CHAT_ID"] = ""
os.environ.pop("RP_REDIS_URL", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db  # noqa: E402
from app.binance_stream import TICKER_CACHE_KEY, stream  # noqa: E402
from app.cache import cache  # noqa: E402
from app.main import app  # noqa: E402
from app.p2p import FX_CACHE_KEY  # noqa: E402

READY = False


def init_test_db():
    global READY
    if not READY:
        db.init_db()
        READY = True


@pytest.fixture(scope="session", autouse=True)
def _cleanup_tmp():
    init_test_db()
    yield
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture()
def client():
    """TestClient without lifespan — no streams, no engine loops, no network."""
    init_test_db()
    return TestClient(app)


@pytest.fixture()
def user(client):
    """Fresh registered user with an authenticated client."""
    email = f"t{uuid.uuid4().hex[:12]}@test.dev"
    res = client.post(
        "/api/auth/register",
        json={"name": "Test User", "email": email, "password": "secret123"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    authed = TestClient(app)
    authed.headers["Authorization"] = f"Bearer {body['token']}"
    return {"client": authed, "token": body["token"], "email": email, "id": body["user"]["id"]}


@pytest.fixture()
def tickers():
    """Seeded ticker snapshot so demo fills and portfolio math never hit Binance."""
    snapshot = {
        "BTCUSDT": _ticker("BTCUSDT", 100_000.0),
        "ETHUSDT": _ticker("ETHUSDT", 2_000.0),
        "SOLUSDT": _ticker("SOLUSDT", 100.0),
    }
    cache.set(TICKER_CACHE_KEY, snapshot, ttl=120)
    cache.set(FX_CACHE_KEY, 277.0, ttl=60)  # so PKR enrichment never fetches
    stream.tickers.update(snapshot)
    yield snapshot
    for symbol in snapshot:
        stream.tickers.pop(symbol, None)


@pytest.fixture()
def pkr_rate(monkeypatch):
    monkeypatch.setattr("app.trade._pkr_rate", lambda: 277.0)
    return 277.0


def _ticker(symbol: str, price: float) -> dict:
    return {
        "symbol": symbol,
        "price": price,
        "open": price,
        "high": price,
        "low": price,
        "volume": 1.0,
        "quoteVolume": price,
        "change_pct": 0.0,
        "change": 0.0,
        "ts": 0,
    }
