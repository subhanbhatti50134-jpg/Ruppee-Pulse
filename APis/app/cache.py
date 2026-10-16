import json
import logging
import os
import threading
import time

log = logging.getLogger("rp.cache")


class TTLCache:
    """Thread-safe in-memory cache with per-entry TTL.

    Drop-in replacement for the Redis layer described in the proposal:
    prevents Binance/P2P rate-limit bans by absorbing repeated reads.
    """

    def __init__(self, max_items: int = 4096):
        self._store: dict[str, tuple[float, object]] = {}
        self._lock = threading.Lock()
        self._max_items = max_items

    def get(self, key: str, default=None):
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return default
            expires_at, value = entry
            if expires_at and expires_at < time.time():
                self._store.pop(key, None)
                return default
            return value

    def set(self, key: str, value, ttl: float | None = None):
        expires_at = time.time() + ttl if ttl else 0.0
        with self._lock:
            if len(self._store) >= self._max_items and key not in self._store:
                self._evict_locked()
            self._store[key] = (expires_at, value)

    def get_or_set(self, key: str, factory, ttl: float | None = None):
        cached = self.get(key, _MISSING)
        if cached is not _MISSING:
            return cached
        value = factory()
        self.set(key, value, ttl)
        return value

    def pop(self, key: str):
        with self._lock:
            entry = self._store.pop(key, None)
        if entry is None:
            return None
        return entry[1]

    def clear(self):
        with self._lock:
            self._store.clear()

    def _evict_locked(self):
        now = time.time()
        expired = [k for k, (exp, _) in self._store.items() if exp and exp < now]
        for k in expired:
            self._store.pop(k, None)
        if len(self._store) >= self._max_items:
            oldest = sorted(self._store.items(), key=lambda kv: kv[1][0])[: self._max_items // 4]
            for k, _ in oldest:
                self._store.pop(k, None)


class RedisCache:
    """Same interface as TTLCache, backed by Redis (JSON-encoded values).

    Enabled by setting ``RP_REDIS_URL`` (e.g. ``redis://localhost:6379/0``).
    Any failure — missing ``redis`` package, connection error, non-JSON value —
    transparently falls back to an in-process TTLCache so the app never breaks.
    """

    def __init__(self, url: str, fallback: TTLCache | None = None):
        import redis  # optional dependency (in requirements.txt)

        self._client = redis.Redis.from_url(
            url, socket_timeout=2, socket_connect_timeout=2, socket_keepalive=True
        )
        self._client.ping()  # raises if Redis is unreachable at startup
        self._fallback = fallback or TTLCache()
        self.backend = "redis"

    def get(self, key: str, default=None):
        try:
            raw = self._client.get(key)
        except Exception as exc:  # connection blip → local fallback
            log.debug("redis get failed (%s); using local cache", exc)
            return self._fallback.get(key, default)
        if raw is None:
            return default
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return default

    def set(self, key: str, value, ttl: float | None = None):
        try:
            payload = json.dumps(value)
        except (TypeError, ValueError):
            self._fallback.set(key, value, ttl)  # non-serializable → local only
            return
        try:
            self._client.set(key, payload, ex=int(ttl) if ttl else None)
        except Exception as exc:
            log.debug("redis set failed (%s); using local cache", exc)
            self._fallback.set(key, value, ttl)

    def get_or_set(self, key: str, factory, ttl: float | None = None):
        cached = self.get(key, _MISSING)
        if cached is not _MISSING:
            return cached
        value = factory()
        self.set(key, value, ttl)
        return value

    def pop(self, key: str):
        try:
            raw = self._client.getdel(key) if hasattr(self._client, "getdel") else self._client.get(key)
            if raw is not None:
                self._client.delete(key)
                return json.loads(raw)
        except Exception as exc:
            log.debug("redis pop failed (%s); using local cache", exc)
        return self._fallback.pop(key)

    def clear(self):
        try:
            self._client.flushdb()
        except Exception:
            pass
        self._fallback.clear()


class _Missing:
    pass


_MISSING = _Missing()


def build_cache():
    """Redis when RP_REDIS_URL is set and reachable, otherwise in-memory."""
    url = os.environ.get("RP_REDIS_URL", "").strip()
    if not url:
        return TTLCache()
    try:
        cache = RedisCache(url)
        log.info("cache backend: redis (%s)", url)
        return cache
    except Exception as exc:
        log.warning("RP_REDIS_URL set but unusable (%s); falling back to in-memory cache", exc)
        return TTLCache()


cache = build_cache()
