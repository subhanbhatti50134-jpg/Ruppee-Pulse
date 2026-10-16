from fastapi import APIRouter, HTTPException, Request

from .. import db
from ..models import StopOrderIn
from .auth import get_current_user

router = APIRouter(prefix="/api/stops", tags=["stops"])


@router.get("")
def list_stops(request: Request):
    user = get_current_user(request)
    stops = db.list_stop_orders(user["id"])
    pending = [s for s in stops if s["status"] == "PENDING"]
    return {"stops": stops, "pending_count": len(pending)}


@router.post("")
def create_stop(payload: StopOrderIn, request: Request):
    user = get_current_user(request)
    if not payload.quantity and not payload.quote_quantity:
        raise HTTPException(status_code=400, detail="Provide quantity or total")
    symbol = payload.symbol.upper()
    if not symbol.endswith("USDT"):
        symbol += "USDT"
    stop = db.create_stop_order(
        user["id"],
        symbol,
        payload.side,
        payload.kind,
        payload.trigger_price,
        payload.quantity,
        payload.quote_quantity,
        payload.mode,
    )
    return {"stop": stop}


@router.delete("/{stop_id}")
def delete_stop(stop_id: str, request: Request):
    user = get_current_user(request)
    if not db.delete_stop_order(user["id"], stop_id):
        raise HTTPException(status_code=404, detail="Pending stop not found")
    return {"ok": True}
