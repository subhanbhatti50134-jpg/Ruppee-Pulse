import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db
from . import stops as stop_engine
from .alerts import alert_engine
from .binance_stream import stream
from .config import CORS_ORIGINS
from .p2p import aggregator, premium_history
from .routers import alerts as alerts_router
from .routers import auth as auth_router
from .routers import market as market_router
from .routers import p2p as p2p_router
from .routers import stops as stops_router
from .routers import telegram as telegram_router
from .routers import trade as trade_router
from .routers import watchlist as watchlist_router
from .trade import demo_fill_loop
from .ws import router as ws_router
from .ws import start_hub, stop_hub

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("rp.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    premium_history.load()
    await stream.start()
    await aggregator.start()
    await alert_engine.start()
    await start_hub()
    fill_task = __import__("asyncio").create_task(demo_fill_loop(), name="demo-fill-loop")
    stops_task = await stop_engine.start()
    log.info("RupeePulse backend ready")
    yield
    stops_task.cancel()
    fill_task.cancel()
    await stop_hub()
    await alert_engine.stop()
    await aggregator.stop()
    await stream.stop()
    log.info("RupeePulse backend stopped")


app = FastAPI(title="RupeePulse API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(market_router.router)
app.include_router(p2p_router.router)
app.include_router(trade_router.router)
app.include_router(alerts_router.router)
app.include_router(alerts_router.price_router)
app.include_router(watchlist_router.router)
app.include_router(stops_router.router)
app.include_router(telegram_router.router)
app.include_router(ws_router)


@app.get("/api/health")
def health():
    from .p2p import get_interbank_rate, get_p2p_state

    return {
        "status": "ok",
        "stream_connected": stream.connected,
        "tickers": len(stream.tickers),
        "p2p_ts": get_p2p_state().get("ts"),
        "interbank": get_interbank_rate(),
        "p2p_error": aggregator.last_error,
    }


# ---------------------------------------------------------------- SPA hosting
# When ui/dist exists (run `npm run build` first), the backend serves the
# production bundle directly — no separate web server required.
DIST_DIR = Path(__file__).resolve().parent.parent.parent / "ui" / "dist"

if DIST_DIR.is_dir():
    assets = DIST_DIR / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="static-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        # Never shadow the API or the websocket endpoint with index.html.
        if full_path.startswith(("api/", "ws", "docs", "openapi.json")):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (DIST_DIR / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(DIST_DIR.resolve()):
            return FileResponse(candidate)
        return FileResponse(DIST_DIR / "index.html")

    log.info("Serving UI from %s", DIST_DIR)
