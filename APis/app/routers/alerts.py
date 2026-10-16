from fastapi import APIRouter, HTTPException, Request

from .. import db
from ..models import AlertRuleIn, PriceAlertIn
from .auth import get_current_user

router = APIRouter(prefix="/api/alerts", tags=["alerts"])
price_router = APIRouter(prefix="/api/price-alerts", tags=["alerts"])


@router.get("")
def list_alerts(request: Request):
    user = get_current_user(request)
    return {
        "rules": db.list_alert_rules(user["id"]),
        "events": db.list_alert_events(user["id"], limit=50),
    }


@router.post("")
def create_rule(payload: AlertRuleIn, request: Request):
    user = get_current_user(request)
    rule = db.create_alert_rule(user["id"], payload.direction, payload.threshold)
    return {"rule": rule}


@router.delete("/{rule_id}")
def delete_rule(rule_id: str, request: Request):
    user = get_current_user(request)
    if not db.delete_alert_rule(user["id"], rule_id):
        raise HTTPException(status_code=404, detail="Alert rule not found")
    return {"ok": True}


# ---------------------------------------------------------------- price alerts


@price_router.get("")
def list_price_alerts(request: Request):
    user = get_current_user(request)
    return {"alerts": db.list_price_alerts(user["id"])}


@price_router.post("")
def create_price_alert(payload: PriceAlertIn, request: Request):
    user = get_current_user(request)
    symbol = payload.symbol.upper()
    if not symbol.endswith("USDT"):
        symbol += "USDT"
    alert = db.create_price_alert(
        user["id"], symbol, payload.direction, payload.price, payload.one_shot
    )
    return {"alert": alert}


@price_router.delete("/{alert_id}")
def delete_price_alert(alert_id: str, request: Request):
    user = get_current_user(request)
    if not db.delete_price_alert(user["id"], alert_id):
        raise HTTPException(status_code=404, detail="Price alert not found")
    return {"ok": True}


@price_router.post("/{alert_id}/toggle")
def toggle_price_alert(alert_id: str, request: Request):
    user = get_current_user(request)
    alert = db.toggle_price_alert(user["id"], alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Price alert not found")
    return {"alert": alert}
