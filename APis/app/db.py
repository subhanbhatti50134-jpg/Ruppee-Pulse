"""SQLite persistence layer (users, sessions, API keys, orders, alerts)."""

import json
import sqlite3
import threading
import time
import uuid

from .config import ALERT_RETENTION, DB_PATH, DEMO_STARTING_BALANCE

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_key TEXT NOT NULL,
    encrypted_secret TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS demo_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balances TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    type TEXT NOT NULL,
    price REAL,
    quantity REAL NOT NULL,
    quote_quantity REAL,
    status TEXT NOT NULL,
    mode TEXT NOT NULL,
    binance_order_id TEXT,
    avg_price REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    threshold REAL NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_fired_at REAL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_events (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    payload TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    created_at REAL NOT NULL,
    PRIMARY KEY (user_id, symbol)
);
CREATE TABLE IF NOT EXISTS price_alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    price REAL NOT NULL,
    one_shot INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_fired_at REAL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS premium_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    p2p_rate REAL,
    interbank_rate REAL,
    premium_pct REAL,
    delta REAL
);
CREATE TABLE IF NOT EXISTS stop_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    kind TEXT NOT NULL,
    trigger_price REAL NOT NULL,
    quantity REAL,
    quote_quantity REAL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    linked_order_id TEXT,
    error TEXT,
    created_at REAL NOT NULL,
    triggered_at REAL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_created ON alert_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_premium_samples_ts ON premium_samples(ts);
CREATE INDEX IF NOT EXISTS idx_stop_orders_status ON stop_orders(status);
"""


def get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(SCHEMA)
        _conn.commit()
    return _conn


def init_db():
    with _lock:
        get_conn()


def _rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------- users


def create_user(name: str, email: str, password_hash: str) -> dict:
    user = {
        "id": uuid.uuid4().hex,
        "name": name,
        "email": email,
        "password_hash": password_hash,
        "created_at": time.time(),
    }
    with _lock:
        conn = get_conn()
        conn.execute(
            "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?,?,?,?,?)",
            (user["id"], user["name"], user["email"], user["password_hash"], user["created_at"]),
        )
        conn.execute(
            "INSERT INTO demo_accounts (user_id, balances, created_at) VALUES (?,?,?)",
            (
                user["id"],
                json.dumps({"USDT": {"free": DEMO_STARTING_BALANCE, "locked": 0.0}}),
                time.time(),
            ),
        )
        conn.commit()
    return user


def get_user_by_email(email: str) -> dict | None:
    cur = get_conn().execute("SELECT * FROM users WHERE email = ?", (email,))
    row = cur.fetchone()
    return dict(row) if row else None


def get_user(user_id: str) -> dict | None:
    cur = get_conn().execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    return dict(row) if row else None


# ---------------------------------------------------------------- sessions


def create_session(user_id: str, ttl_seconds: int) -> str:
    from .security import new_session_token

    token = new_session_token()
    expires_at = time.time() + ttl_seconds
    with _lock:
        conn = get_conn()
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)",
            (token, user_id, expires_at),
        )
        conn.commit()
    return token


def get_session(token: str) -> dict | None:
    cur = get_conn().execute(
        "SELECT * FROM sessions WHERE token = ? AND expires_at > ?", (token, time.time())
    )
    row = cur.fetchone()
    return dict(row) if row else None


def delete_session(token: str):
    with _lock:
        conn = get_conn()
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()


def set_user_password(user_id: str, password_hash: str):
    with _lock:
        conn = get_conn()
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
        conn.commit()


def delete_other_sessions(user_id: str, keep_token: str):
    """Revoke every session for the user except the caller's token."""
    with _lock:
        conn = get_conn()
        conn.execute(
            "DELETE FROM sessions WHERE user_id = ? AND token != ?", (user_id, keep_token)
        )
        conn.commit()


# ---------------------------------------------------------------- api keys


def save_api_keys(user_id: str, enc_key: str, enc_secret: str):
    with _lock:
        conn = get_conn()
        conn.execute(
            """INSERT INTO api_keys (user_id, encrypted_key, encrypted_secret, created_at)
               VALUES (?,?,?,?)
               ON CONFLICT(user_id) DO UPDATE SET encrypted_key=excluded.encrypted_key,
                   encrypted_secret=excluded.encrypted_secret, created_at=excluded.created_at""",
            (user_id, enc_key, enc_secret, time.time()),
        )
        conn.commit()


def get_api_keys(user_id: str) -> dict | None:
    cur = get_conn().execute("SELECT * FROM api_keys WHERE user_id = ?", (user_id,))
    row = cur.fetchone()
    return dict(row) if row else None


def delete_api_keys(user_id: str):
    with _lock:
        conn = get_conn()
        conn.execute("DELETE FROM api_keys WHERE user_id = ?", (user_id,))
        conn.commit()


# ---------------------------------------------------------------- demo balances


def get_demo_balances(user_id: str) -> dict:
    cur = get_conn().execute("SELECT balances FROM demo_accounts WHERE user_id = ?", (user_id,))
    row = cur.fetchone()
    if not row:
        balances = {"USDT": {"free": DEMO_STARTING_BALANCE, "locked": 0.0}}
        with _lock:
            conn = get_conn()
            conn.execute(
                "INSERT INTO demo_accounts (user_id, balances, created_at) VALUES (?,?,?)",
                (user_id, json.dumps(balances), time.time()),
            )
            conn.commit()
        return balances
    return json.loads(row["balances"])


def save_demo_balances(user_id: str, balances: dict):
    with _lock:
        conn = get_conn()
        conn.execute(
            """INSERT INTO demo_accounts (user_id, balances, created_at) VALUES (?,?,?)
               ON CONFLICT(user_id) DO UPDATE SET balances=excluded.balances""",
            (user_id, json.dumps(balances), time.time()),
        )
        conn.commit()


def reset_demo_account(user_id: str) -> dict:
    balances = {"USDT": {"free": DEMO_STARTING_BALANCE, "locked": 0.0}}
    save_demo_balances(user_id, balances)
    with _lock:
        conn = get_conn()
        conn.execute("DELETE FROM orders WHERE user_id = ? AND mode = 'demo'", (user_id,))
        conn.commit()
    return balances


# ---------------------------------------------------------------- orders


def insert_order(order: dict):
    with _lock:
        conn = get_conn()
        conn.execute(
            """INSERT INTO orders (id, user_id, symbol, side, type, price, quantity,
               quote_quantity, status, mode, binance_order_id, avg_price, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                order["id"],
                order["user_id"],
                order["symbol"],
                order["side"],
                order["type"],
                order.get("price"),
                order["quantity"],
                order.get("quote_quantity"),
                order["status"],
                order["mode"],
                order.get("binance_order_id"),
                order.get("avg_price"),
                order["created_at"],
                order["updated_at"],
            ),
        )
        conn.commit()


def update_order(order_id: str, **fields):
    if not fields:
        return
    fields["updated_at"] = time.time()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with _lock:
        conn = get_conn()
        conn.execute(f"UPDATE orders SET {cols} WHERE id = ?", (*fields.values(), order_id))
        conn.commit()


def list_orders(user_id: str, status: str | None = None, limit: int = 50) -> list[dict]:
    if status:
        cur = get_conn().execute(
            "SELECT * FROM orders WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, status, limit),
        )
    else:
        cur = get_conn().execute(
            "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        )
    return _rows(cur)


def list_open_demo_orders() -> list[dict]:
    cur = get_conn().execute("SELECT * FROM orders WHERE mode = 'demo' AND status = 'NEW'")
    return _rows(cur)


# ---------------------------------------------------------------- alerts


def create_alert_rule(user_id: str, direction: str, threshold: float) -> dict:
    rule = {
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "direction": direction,
        "threshold": threshold,
        "enabled": 1,
        "last_fired_at": None,
        "created_at": time.time(),
    }
    with _lock:
        conn = get_conn()
        conn.execute(
            """INSERT INTO alert_rules (id, user_id, direction, threshold, enabled, created_at)
               VALUES (?,?,?,?,?,?)""",
            (rule["id"], user_id, direction, threshold, 1, rule["created_at"]),
        )
        conn.commit()
    return rule


def list_alert_rules(user_id: str) -> list[dict]:
    cur = get_conn().execute(
        "SELECT * FROM alert_rules WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
    )
    return _rows(cur)


def delete_alert_rule(user_id: str, rule_id: str) -> bool:
    with _lock:
        conn = get_conn()
        cur = conn.execute(
            "DELETE FROM alert_rules WHERE id = ? AND user_id = ?", (rule_id, user_id)
        )
        conn.commit()
        return cur.rowcount > 0


def mark_alert_fired(rule_id: str):
    with _lock:
        conn = get_conn()
        conn.execute(
            "UPDATE alert_rules SET last_fired_at = ? WHERE id = ?", (time.time(), rule_id)
        )
        conn.commit()


def enabled_alert_rules() -> list[dict]:
    cur = get_conn().execute("SELECT * FROM alert_rules WHERE enabled = 1")
    return _rows(cur)


def insert_alert_event(kind: str, message: str, payload: dict | None = None, user_id: str | None = None):
    event = {
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "kind": kind,
        "message": message,
        "payload": json.dumps(payload or {}),
        "created_at": time.time(),
    }
    with _lock:
        conn = get_conn()
        conn.execute(
            """INSERT INTO alert_events (id, user_id, kind, message, payload, created_at)
               VALUES (?,?,?,?,?,?)""",
            (event["id"], user_id, kind, message, event["payload"], event["created_at"]),
        )
        conn.execute(
            """DELETE FROM alert_events WHERE id NOT IN (
                 SELECT id FROM alert_events ORDER BY created_at DESC LIMIT ?
               )""",
            (ALERT_RETENTION,),
        )
        conn.commit()
    event["payload"] = payload or {}
    return event


def list_alert_events(user_id: str | None = None, limit: int = 50) -> list[dict]:
    if user_id:
        cur = get_conn().execute(
            "SELECT * FROM alert_events WHERE user_id IS NULL OR user_id = ? "
            "ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        )
    else:
        cur = get_conn().execute(
            "SELECT * FROM alert_events ORDER BY created_at DESC LIMIT ?", (limit,)
        )
    out = []
    for row in cur.fetchall():
        item = dict(row)
        try:
            item["payload"] = json.loads(item.get("payload") or "{}")
        except json.JSONDecodeError:
            item["payload"] = {}
        out.append(item)
    return out


# ---------------------------------------------------------------- watchlist


def list_watchlist(user_id: str) -> list[str]:
    cur = get_conn().execute(
        "SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY created_at", (user_id,)
    )
    return [row["symbol"] for row in cur.fetchall()]


def add_watchlist(user_id: str, symbol: str) -> bool:
    with _lock:
        conn = get_conn()
        cur = conn.execute(
            "INSERT OR IGNORE INTO watchlist (user_id, symbol, created_at) VALUES (?,?,?)",
            (user_id, symbol, time.time()),
        )
        conn.commit()
        return cur.rowcount > 0


def remove_watchlist(user_id: str, symbol: str) -> bool:
    with _lock:
        conn = get_conn()
        cur = conn.execute(
            "DELETE FROM watchlist WHERE user_id = ? AND symbol = ?", (user_id, symbol)
        )
        conn.commit()
        return cur.rowcount > 0


# ---------------------------------------------------------------- price alerts


def list_price_alerts(user_id: str) -> list[dict]:
    cur = get_conn().execute(
        "SELECT * FROM price_alerts WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
    )
    return _rows(cur)


def create_price_alert(
    user_id: str, symbol: str, direction: str, price: float, one_shot: bool = True
) -> dict:
    alert = {
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "symbol": symbol,
        "direction": direction,
        "price": price,
        "one_shot": 1 if one_shot else 0,
        "enabled": 1,
        "last_fired_at": None,
        "created_at": time.time(),
    }
    with _lock:
        conn = get_conn()
        conn.execute(
            """INSERT INTO price_alerts
               (id, user_id, symbol, direction, price, one_shot, enabled, created_at)
               VALUES (?,?,?,?,?,?,1,?)""",
            (
                alert["id"],
                user_id,
                symbol,
                direction,
                price,
                alert["one_shot"],
                alert["created_at"],
            ),
        )
        conn.commit()
    return alert


def delete_price_alert(user_id: str, alert_id: str) -> bool:
    with _lock:
        conn = get_conn()
        cur = conn.execute(
            "DELETE FROM price_alerts WHERE id = ? AND user_id = ?", (alert_id, user_id)
        )
        conn.commit()
        return cur.rowcount > 0


def toggle_price_alert(user_id: str, alert_id: str) -> dict | None:
    with _lock:
        conn = get_conn()
        conn.execute(
            "UPDATE price_alerts SET enabled = 1 - enabled WHERE id = ? AND user_id = ?",
            (alert_id, user_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM price_alerts WHERE id = ? AND user_id = ?", (alert_id, user_id)
        ).fetchone()
    return dict(row) if row else None


def list_enabled_price_alerts() -> list[dict]:
    cur = get_conn().execute("SELECT * FROM price_alerts WHERE enabled = 1")
    return _rows(cur)


def mark_price_alert_fired(alert_id: str, disable: bool = False):
    with _lock:
        conn = get_conn()
        if disable:
            conn.execute(
                "UPDATE price_alerts SET last_fired_at = ?, enabled = 0 WHERE id = ?",
                (time.time(), alert_id),
            )
        else:
            conn.execute(
                "UPDATE price_alerts SET last_fired_at = ? WHERE id = ?",
                (time.time(), alert_id),
            )
        conn.commit()


# ---------------------------------------------------------------- premium samples


def insert_premium_sample(premium: dict) -> None:
    with _lock:
        conn = get_conn()
        conn.execute(
            """INSERT INTO premium_samples (ts, p2p_rate, interbank_rate, premium_pct, delta)
               VALUES (?,?,?,?,?)""",
            (
                time.time(),
                premium.get("p2p_rate"),
                premium.get("interbank_rate"),
                premium.get("premium_pct"),
                premium.get("delta"),
            ),
        )
        conn.execute(
            "DELETE FROM premium_samples WHERE ts < ?",
            (time.time() - 86400 * 3,),
        )
        conn.commit()


def recent_premium_samples(limit: int) -> list[dict]:
    cur = get_conn().execute(
        "SELECT ts, p2p_rate, interbank_rate, premium_pct, delta FROM premium_samples "
        "ORDER BY ts DESC LIMIT ?",
        (limit,),
    )
    rows = _rows(cur)
    rows.reverse()  # oldest first for the chart / MA
    return rows


# ---------------------------------------------------------------- stop orders (SL/TP)


def create_stop_order(
    user_id: str,
    symbol: str,
    side: str,
    kind: str,
    trigger_price: float,
    quantity: float | None,
    quote_quantity: float | None,
    mode: str,
) -> dict:
    stop = {
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "symbol": symbol,
        "side": side,
        "kind": kind,
        "trigger_price": trigger_price,
        "quantity": quantity,
        "quote_quantity": quote_quantity,
        "mode": mode,
        "status": "PENDING",
        "linked_order_id": None,
        "error": None,
        "created_at": time.time(),
        "triggered_at": None,
    }
    with _lock:
        conn = get_conn()
        conn.execute(
            """INSERT INTO stop_orders (id, user_id, symbol, side, kind, trigger_price,
               quantity, quote_quantity, mode, status, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,'PENDING',?)""",
            (
                stop["id"], user_id, symbol, side, kind, trigger_price,
                quantity, quote_quantity, mode, stop["created_at"],
            ),
        )
        conn.commit()
    return stop


def list_stop_orders(user_id: str, status: str | None = None, limit: int = 100) -> list[dict]:
    if status:
        cur = get_conn().execute(
            "SELECT * FROM stop_orders WHERE user_id = ? AND status = ? "
            "ORDER BY created_at DESC LIMIT ?",
            (user_id, status, limit),
        )
    else:
        cur = get_conn().execute(
            "SELECT * FROM stop_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        )
    return _rows(cur)


def list_pending_stop_orders() -> list[dict]:
    cur = get_conn().execute("SELECT * FROM stop_orders WHERE status = 'PENDING'")
    return _rows(cur)


def claim_stop_order(stop_id: str) -> bool:
    """Atomically flip PENDING -> TRIGGERED so a stop can only fire once."""
    with _lock:
        conn = get_conn()
        cur = conn.execute(
            "UPDATE stop_orders SET status = 'TRIGGERED', triggered_at = ? "
            "WHERE id = ? AND status = 'PENDING'",
            (time.time(), stop_id),
        )
        conn.commit()
        return cur.rowcount > 0


def finalize_stop_order(stop_id: str, linked_order_id: str | None = None, error: str | None = None):
    with _lock:
        conn = get_conn()
        status = "FAILED" if error else "FILLED"
        conn.execute(
            "UPDATE stop_orders SET status = ?, linked_order_id = ?, error = ? WHERE id = ?",
            (status, linked_order_id, error, stop_id),
        )
        conn.commit()


def delete_stop_order(user_id: str, stop_id: str) -> bool:
    with _lock:
        conn = get_conn()
        cur = conn.execute(
            "DELETE FROM stop_orders WHERE id = ? AND user_id = ? AND status = 'PENDING'",
            (stop_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
