import time

from app.cache import TTLCache, build_cache


def test_ttl_cache_roundtrip():
    c = TTLCache()
    assert c.get("missing") is None
    assert c.get("missing", "fallback") == "fallback"
    c.set("k", {"a": 1}, ttl=60)
    assert c.get("k") == {"a": 1}
    assert c.pop("k") == {"a": 1}
    assert c.get("k") is None
    assert c.pop("k") is None


def test_ttl_cache_expiry():
    c = TTLCache()
    c.set("k", "v", ttl=0.05)
    assert c.get("k") == "v"
    time.sleep(0.08)
    assert c.get("k") is None


def test_get_or_set_computes_once():
    c = TTLCache()
    calls = []

    def factory():
        calls.append(1)
        return "computed"

    assert c.get_or_set("k", factory, ttl=30) == "computed"
    assert c.get_or_set("k", factory, ttl=30) == "computed"
    assert len(calls) == 1


def test_cache_clear():
    c = TTLCache()
    c.set("a", 1)
    c.set("b", 2)
    c.clear()
    assert c.get("a") is None and c.get("b") is None


def test_build_cache_defaults_to_memory(monkeypatch):
    monkeypatch.delenv("RP_REDIS_URL", raising=False)
    assert isinstance(build_cache(), TTLCache)


def test_build_cache_falls_back_when_redis_unreachable(monkeypatch):
    # port 9 (discard) should refuse connections -> in-memory fallback, app keeps working
    monkeypatch.setenv("RP_REDIS_URL", "redis://127.0.0.1:9/0")
    assert isinstance(build_cache(), TTLCache)
