# Ruppee Pulse

Low-latency cryptocurrency trading & analytics dashboard for the Pakistani market.
Live Binance spot prices in **USD** shown side-by-side with **PKR** valuations from live
Binance P2P merchant rates — plus spread/premium analytics, arbitrage alerts, and a
secure order-execution module.

## Quick start

```bash
cd "/home/muhammadsubhan/Desktop/Ruppee Pulse"
./run.sh
```

- Frontend → http://localhost:5173
- Backend  → http://127.0.0.1:8010 (health: `/api/health`, docs: `/docs`)

Or start them separately:

```bash
# backend
cd APis
./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010

# frontend (new terminal)
cd ui
npm run dev
```

First run creates the venv/DB automatically. To reset all data (users, orders, keys),
stop the backend and delete `APis/data/ruppepulse.db`.

### Open it on your phone (production mode)

```bash
cd ui && npm run build          # one bundle served by the backend
# restart the backend on all interfaces:
cd ../APis && ./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8010
```

Then on any device on the same Wi-Fi: **http://\<your-LAN-IP\>:8010** (find the IP
with `hostname -I`). UI, API and WebSocket share that one port — a plain HTTP
"Not Secure" notice from the browser is expected on a LAN.

## What it does (proposal coverage)

| Proposal item | Implementation |
| --- | --- |
| Real-time price discovery (Binance WebSockets) | `APis/app/binance_stream.py` — 16 major pairs streamed live, fanned out to browsers over `/ws` |
| Accurate PKR valuation via P2P | `APis/app/p2p.py` — Binance P2P aggregator every 60s (BUY + SELL sides, outlier-clamped best rates) |
| Dual-currency ticker | Overview & Market pages show USD price + PKR price (P2P rate) simultaneously |
| P2P spread calculator | Per-payment-method rates (Easypaisa, Raast, Bank Transfer, SadaPay, NayaPay, Upaisa), spread, premium % vs interbank |
| Interbank reference rate | `open.er-api.com` with `exchangerate-api` fallback, hourly cache |
| Trade execution module | `APis/app/trade.py` — market & limit orders, open orders, cancel, balances (live Binance or demo paper trading) |
| AES-256 API-key storage | `APis/app/security.py` — AES-256-GCM + PBKDF2 (200k), master key in `APis/data/master.key` |
| Arbitrage & premium alerts | `APis/app/alerts.py` — auto alerts when premium deviates ±1.5 pts from its 30-pt moving average + user threshold rules; pushed as toast pop-ups and stored in Alert Feed |
| In-memory cache (Redis role) | `APis/app/cache.py` — TTL cache absorbing repeated reads so Binance rate limits aren't burned |
| Candlestick charts | `lightweight-charts` v5 in `ui/src/components/CandleChart.jsx` (candles + volume + live tick folding, MA7/25/99 overlays and a synced RSI(14) subchart, 1m–1d intervals) |
| Auth | Register/login/logout against FastAPI, PBKDF2-hashed passwords, bearer sessions, password change (revokes other sessions) |
| Stop-loss / take-profit | `APis/app/stops.py` — conditional orders watched every 5s, fired as market orders at the trigger; single stops or **OCO** take-profit/stop-loss pairs (one fills → the sibling cancels) and **stop-limit** execution (trigger places a limit order instead of market) |
| Position sizing & PnL | Trade-page calculator (qty/notional/R:R) + `/api/trade/portfolio` average-cost realized/unrealized PnL, shown live per position on Trade with take-profit/close |
| Order book | `/api/market/depth` (Binance depth proxy, 2s cache) rendered as a live ladder on Trade |
| Live keys | Profile → *Test connection* probes the keys against read-only `/api/v3/account` (masked result, spot-trading flag, funded-assets list) before you ever send an order |
| Growth tracking | Wallet → *Portfolio growth* replays your fill history into an equity curve (`/api/trade/equity`), anchored to current balances |

> **Stack note:** the written proposal specifies Node.js/Express; per your choice this
> backend is implemented with **Python FastAPI** in the existing `APis/venv`, keeping the
> same architecture (REST + WebSockets + periodic P2P aggregator + cache layer).
> The cache runs in-memory by default and is **Redis-ready**: set `RP_REDIS_URL`
> (docker-compose does) to share cached data across processes — with an automatic
> in-memory fallback if Redis is unreachable.

## Project structure

```
Ruppee Pulse/
├── run.sh                     # starts backend (:8010) + frontend (:5173)
├── Dockerfile                 # multi-stage: npm build → python image serving API + UI
├── docker-compose.yml         # backend + redis (RP_REDIS_URL preconfigured)
├── APis/                      # FastAPI backend
│   ├── app/
│   │   ├── main.py            # app, CORS, lifespan, serves ui/dist when built
│   │   ├── binance_stream.py  # spot WebSocket stream + REST/signed helpers
│   │   ├── p2p.py             # P2P aggregator, FX, premium history, arbitrage scan
│   │   ├── trade.py           # order execution (live + demo), balances, portfolio PnL
│   │   ├── stops.py           # stop-loss / take-profit trigger engine
│   │   ├── alerts.py          # MA-deviation + threshold + price alert engine
│   │   ├── security.py        # AES-256-GCM, PBKDF2 password hashing
│   │   ├── cache.py           # TTL cache (Redis-ready via RP_REDIS_URL)
│   │   ├── db.py              # SQLite: users, sessions, keys, orders, stops, alerts
│   │   ├── ws.py              # /ws hub (tickers, p2p, alerts fan-out)
│   │   └── routers/           # auth, market, p2p, trade, alerts, stops, telegram
│   ├── tests/                 # pytest suite (49 tests, no network needed)
│   ├── data/                  # SQLite DB + master.key (auto-created)
│   ├── requirements.txt / requirements-dev.txt
│   ├── pyproject.toml         # ruff + pytest config
│   └── .env.example
└── ui/                        # React + Vite + Tailwind
    └── src/
        ├── context/MarketContext.jsx   # WebSocket state for the whole app (coalesced commits)
        ├── components/                 # CandleChart, EquityChart, OrderBook, StopsPanel, PositionCalculator, ...
        └── pages/                      # Overview, Market, Trade, Wallet, Analytics, Profile, auth
```

## Using it

1. **Sign up** (accounts live in the backend DB; passwords are PBKDF2-hashed).
2. **Overview** — live dual-currency ticker, candlestick chart, quick trade ticket,
   P2P funding-rate table, spread & premium panel.
3. **Market** — sortable/filterable ticker table with USD + PKR columns.
4. **Trade** — full chart with MA/RSI indicators and 1m–1d intervals, order ticket
   (market/limit, buy/sell), live order book, stop-loss / take-profit panel with
   **OCO pairs** and **stop-limit** execution, position calculator, positions with
   live profit, open orders with cancel, history with per-trade P&L, balances.
5. **Wallet** — *Positions & PnL* (avg cost, realized/unrealized, allocation bars),
   *Portfolio growth* equity curve, portfolio value in USD & PKR, activity feed,
   demo-fund reset.
6. **Analytics** — premium history chart with MA overlay, arbitrage scanner, live
   P2P ads, premium by payment method, threshold & price alert rules, alert feed.
7. **Profile** — connect/remove Binance API keys (AES-256-GCM encrypted), **test
   connection** with a first-trade safety checklist, change password, Telegram
   alert setup, security info.

On phones (under 700px) the nav collapses to a burger menu with the same links
and a Log out entry; every page is overflow-free at 390×844.

### Watching the market

- **★ stars** (Overview & Market) build your watchlist — persisted per account.
- **★ Watchlist** filter on Market shows only starred symbols.
- **Top gainers / losers** cards jump straight to a trade.
- **Price alerts** on Analytics: symbol + level → toast pop-ups (browser
  notifications via the 🔔 button when the tab is in the background).

### Demo vs live trading

- **No API keys → demo mode:** orders simulate against live prices with 100,000 virtual
  USDT, including limit-order fills by the market-crossing loop.
- **API keys added → live mode:** orders are HMAC-SHA256-signed directly against Binance
  `/api/v3/order`; balances come from `/api/v3/account`. Create keys on Binance with
  *Read* + *Spot Trading* only.

### Positions, profit & closing trades

- **Open positions** (Trade → *POSITIONS & OPEN ORDERS*) show avg cost, live mark,
  value and **unrealized profit** — dollar and percent — updating tick-by-tick from
  the WebSocket stream, with total open P&L in the card header.
- **Take profit / Close** on a position market-sells the holding (two-step confirm,
  so a stray click never dumps it) and reports the realized gain/loss in the notice
  bar — funds return to your balance immediately.
- **Open limit orders** show *Profit now* vs the current mark; **Cancel** withdraws
  the order before it fills.

### Sessions

- Sessions live 7 days; password change signs out every *other* session.
- If a stored token dies (expired, revoked, or cleared elsewhere), the next request
  logs you out visibly and redirects to `/login?reason=expired` with an explanation —
  sign in again and everything continues where you left off.

## API summary

```
POST /api/auth/register|login|logout      GET /api/auth/me
POST /api/auth/change-password            (verifies current, revokes other sessions)
GET  /api/market/tickers                  GET /api/market/klines?symbol=&interval=&limit=
GET  /api/p2p/rates                       GET /api/p2p/analytics
GET  /api/p2p/ads?side=&limit=            GET /api/p2p/arbitrage
POST /api/trade/order                     GET  /api/trade/orders|history|balances
DEL  /api/trade/orders/{id}               POST /api/trade/demo/reset
GET/POST/DELETE /api/trade/keys             POST /api/trade/keys/test (read-only probe)
GET/POST /api/alerts, DELETE /api/alerts/{id}
GET  /api/trade/equity                      (equity curve for the growth chart)
GET/POST /api/watchlist, DEL /api/watchlist/{symbol}
GET/POST /api/price-alerts, DEL /api/price-alerts/{id}, POST /api/price-alerts/{id}/toggle
GET/POST /api/stops, DEL /api/stops/{id}      GET /api/trade/portfolio
GET  /api/market/depth?symbol=&limit=
GET  /api/telegram/status                 POST /api/telegram/test
GET  /api/health                          WS   /ws  (snapshot + tickers + p2p + alerts)
```

### Phase 2 highlights

- **Premium history persistence** — every premium sample is written to SQLite
  (`premium_samples`); chart + moving average are restored on restart.
- **`/api/p2p/ads`** — trimmed live Binance P2P ads (price, methods, limits,
  merchant stats) backing the *Live P2P Ads* table on Analytics.
- **Arbitrage scanner** — `/api/p2p/arbitrage` ranks payment methods by round-trip
  margin (buy → sell); rows clearing `RP_ARB_MARGIN_PCT` raise an `arbitrage`
  alert event + toast (+ Telegram when configured).
- **Telegram** — set `RP_TELEGRAM_BOT_TOKEN` + `RP_TELEGRAM_CHAT_ID`, then use
  *Profile → Telegram alerts → Send test message*. All alert events are forwarded.

### Phase 3 highlights

- **Stop-loss / take-profit** — `/api/stops` arms conditional orders that a 5s
  engine converts into MARKET orders when price crosses the trigger (SQLite
  `stop_orders`, atomic claim so a stop fires once). Fired/failed stops emit a
  `stop` alert event (+ toast/Telegram). Cancel from Trade → *STOP-LOSS /
  TAKE-PROFIT* panel while `PENDING`.
- **Order book** — `/api/market/depth` proxies Binance `/api/v3/depth` (2s
  cache); Trade page renders the bid/ask ladder with depth bars + spread,
  refreshed every 2.5s.
- **Portfolio PnL** — `/api/trade/portfolio` walks filled orders with
  average-cost accounting: per-asset qty, avg cost, realized/unrealized PnL and
  allocation weights. Shown in Wallet → *Positions & PnL*.
- **Position calculator** — Trade page sizes an entry/stop/risk-% plan into
  quantity, notional and R:R using live balance + market price.

### Phase 4 — hardening

- **Tests** — `APis/tests/` (pytest): auth + password change, market/depth,
  demo orders, portfolio math, stop lifecycle (incl. engine fire/fail paths),
  alerts/watchlist, cache behavior, arbitrage math, OCO/stop-limit, equity curve,
  keys-test, SPA serving. Seeded tickers keep the suite offline —
  `cd APis && ./venv/bin/pytest` → 49 passing.
- **Lint** — ruff config in `APis/pyproject.toml`: `./venv/bin/ruff check app tests`.
- **Password change** — `POST /api/auth/change-password` verifies the current
  password (PBKDF2), stores the new one, and revokes every *other* session.
- **Single-server production mode** — `cd ui && npm run build` then start the
  backend: `app/main.py` serves `ui/dist` (hashed `/assets` + SPA fallback for
  client routes, while `/api` and `/ws` keep their JSON/WS behavior). One
  process, no nginx needed.
- **Docker** — `docker compose up --build` runs backend + Redis; `RP_REDIS_URL`
  is preconfigured, data persists in `./APis/data` via volume mount.

### Phase 5 — live trading, growth & polish

- **Live-key safety** — `POST /api/trade/keys/test` probes stored keys against
  read-only `/api/v3/account`; Profile shows the masked key, spot-trading flag,
  withdrawal warning, funded assets, and a *going-live checklist* (read+trade
  keys only, no withdrawal permission, start small, test one order). Binance
  rejections are surfaced verbatim (e.g. `-2014 API-key format invalid`).
- **Portfolio growth** — `GET /api/trade/equity` unwinds your fill history to an
  anchored start state, marks between trades at fill prices, and ends at the live
  balance; Wallet charts the curve with change vs. first trade and realized P&L.
- **OCO orders** — a take-profit and stop-loss can be armed as a linked pair
  (shared `group_id`): when one executes, the engine cancels the sibling and
  annotates the alert. **Stop-limit** triggers place a limit order (optionally
  market-crossing) instead of a market dump. The stops panel switches between
  Single and OCO modes with trigger/limit price inputs.
- **Chart indicators** — MA7/25/99 overlays and an RSI(14) subchart
  (70/30 guide lines, two-way sync with the price pane) fold live ticks between
  fetches; toggled from the chart toolbar next to the interval buttons.
- **Mobile** — nav collapses to a burger menu under 700px (dropdown with all
  links + Log out, closes on navigation); all six routes verified overflow-free
  at 390×844 via headless CDP.
- **Speed** — `MarketContext` coalesces snapshot/tickers/P2P bursts into a
  single 250ms flush and commits tickers only when rendered fields actually
  changed (identical payloads keep their identity → no re-render); Market rows
  and Trade's positions/open-orders/history tables are memoized with
  value-based comparators so live ticks only touch the rows that moved.

## Quality & deployment

```bash
# tests (offline, isolated temp DB)
cd APis && ./venv/bin/pytest

# lint
cd APis && ./venv/bin/ruff check app tests

# frontend checks
cd ui && npm run lint && npm run build

# production: backend serves the built bundle on :8010
cd ui && npm run build
cd ../APis && ./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010

# or the whole stack in Docker (backend + redis)
docker compose up --build
```

## Configuration

See `APis/.env.example`. The frontend proxies `/api` and `/ws` to `127.0.0.1:8010`
(configurable via `VITE_API_TARGET`).
