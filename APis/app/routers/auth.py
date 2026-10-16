from fastapi import APIRouter, Depends, HTTPException, Request

from .. import db
from ..config import SESSION_TTL_SECONDS
from ..models import ChangePasswordIn, LoginIn, RegisterIn
from ..security import hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _public_user(user: dict) -> dict:
    return {"id": user["id"], "name": user["name"], "email": user["email"]}


def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.startswith("Bearer ") else ""
    if not token:
        token = request.query_params.get("token", "")
    session = db.get_session(token) if token else None
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = db.get_user(session["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user["token"] = session["token"]
    return user


require_user = Depends(get_current_user)


@router.post("/register")
def register(payload: RegisterIn):
    email = payload.email.lower().strip()
    if db.get_user_by_email(email):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = db.create_user(payload.name.strip(), email, hash_password(payload.password))
    token = db.create_session(user["id"], SESSION_TTL_SECONDS)
    return {"user": _public_user(user), "token": token}


@router.post("/login")
def login(payload: LoginIn):
    user = db.get_user_by_email(payload.email.lower().strip())
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="The email or password is incorrect.")
    token = db.create_session(user["id"], SESSION_TTL_SECONDS)
    return {"user": _public_user(user), "token": token}


@router.post("/logout")
def logout(request: Request):
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.startswith("Bearer ") else ""
    if token:
        db.delete_session(token)
    return {"ok": True}


@router.get("/me")
def me(user: dict = require_user):
    return {"user": _public_user(user)}


@router.post("/change-password")
def change_password(payload: ChangePasswordIn, user: dict = require_user):
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="The current password is incorrect.")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="The new password must differ from the current one.")
    db.set_user_password(user["id"], hash_password(payload.new_password))
    db.delete_other_sessions(user["id"], user["token"])
    return {"ok": True, "message": "Password updated. Other sessions were signed out."}
