import uuid

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
    if payload.order_type == "LIMIT" and not payload.limit_price:
        raise HTTPException(status_code=400, detail="Limit execution needs a limit price")
    symbol = payload.symbol.upper()
    if not symbol.endswith("USDT"):
        symbol += "USDT"

    legs = [(payload.kind, payload.trigger_price)]
    group_id = None
    if payload.oco_trigger_price is not None:
        if payload.oco_trigger_price == payload.trigger_price:
            raise HTTPException(status_code=400, detail="OCO legs need different trigger prices")
        other = "STOP_LOSS" if payload.kind == "TAKE_PROFIT" else "TAKE_PROFIT"
        legs.append((other, payload.oco_trigger_price))
        group_id = uuid.uuid4().hex

    stops = [
        db.create_stop_order(
            user["id"],
            symbol,
            payload.side,
            kind,
            trigger,
            payload.quantity,
            payload.quote_quantity,
            payload.mode,
            order_type=payload.order_type,
            limit_price=payload.limit_price,
            group_id=group_id,
        )
        for kind, trigger in legs
    ]
    return {"stop": stops[0], "stops": stops, "group_id": group_id}


@router.delete("/{stop_id}")
def delete_stop(stop_id: str, request: Request):
    user = get_current_user(request)
    if not db.delete_stop_order(user["id"], stop_id):
        raise HTTPException(status_code=404, detail="Pending stop not found")
    return {"ok": True}
