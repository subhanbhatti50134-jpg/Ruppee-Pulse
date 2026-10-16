"""WebSocket hub: streams tickers, P2P rates and alerts to connected dashboards."""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .alerts import alert_engine
from .binance_stream import stream
from .p2p import aggregator

log = logging.getLogger("rp.ws")

router = APIRouter()


class WSHub:
    def __init__(self):
        self.clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self.clients.add(ws)

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self.clients.discard(ws)

    async def broadcast(self, message: dict):
        if not self.clients:
            return
        data = json.dumps(message, default=str)
        async with self._lock:
            targets = list(self.clients)
        dead = []
        for ws in targets:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)


hub = WSHub()


def _snapshot() -> dict:
    from .p2p import compute_premium, get_interbank_rate, get_p2p_state, premium_history

    p2p_state = get_p2p_state()
    interbank = get_interbank_rate()
    return {
        "type": "snapshot",
        "data": {
            "tickers": stream.tickers,
            "stream_connected": stream.connected,
            "p2p": {
                "p2p": p2p_state,
                "interbank": interbank,
                "premium": compute_premium(p2p_state, interbank),
                "ma": premium_history.moving_average(),
            },
        },
    }


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await hub.connect(ws)
    try:
        await ws.send_text(json.dumps(_snapshot(), default=str))
        while True:
            # Clients may send pings; we just drain the receive queue.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.debug("ws closed: %s", exc)
    finally:
        await hub.disconnect(ws)


async def start_hub():
    stream.subscribe(hub.broadcast)
    aggregator.subscribe(hub.broadcast)
    alert_engine.subscribe(hub.broadcast)


async def stop_hub():
    stream.unsubscribe(hub.broadcast)
    aggregator.unsubscribe(hub.broadcast)
    alert_engine.unsubscribe(hub.broadcast)
