from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class ApiKeysIn(BaseModel):
    api_key: str = Field(min_length=8, max_length=256)
    api_secret: str = Field(min_length=8, max_length=256)


class OrderIn(BaseModel):
    symbol: str = Field(min_length=5, max_length=20)
    side: str = Field(pattern="^(BUY|SELL)$")
    type: str = Field(pattern="^(MARKET|LIMIT)$")
    quantity: float | None = Field(default=None, gt=0)
    quote_quantity: float | None = Field(default=None, gt=0)
    price: float | None = Field(default=None, gt=0)
    mode: str = Field(default="auto", pattern="^(auto|demo|live)$")


class AlertRuleIn(BaseModel):
    direction: str = Field(pattern="^(above|below)$")
    threshold: float = Field(gt=0)


class WatchlistIn(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)


class PriceAlertIn(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)
    direction: str = Field(pattern="^(up|down)$")
    price: float = Field(gt=0)
    one_shot: bool = True


class StopOrderIn(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)
    side: str = Field(pattern="^(BUY|SELL)$")
    kind: str = Field(pattern="^(STOP_LOSS|TAKE_PROFIT)$")
    trigger_price: float = Field(gt=0)
    quantity: float | None = Field(default=None, gt=0)
    quote_quantity: float | None = Field(default=None, gt=0)
    mode: str = Field(default="auto", pattern="^(auto|demo|live)$")
