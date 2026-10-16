"""AES-256-GCM encryption module for Binance API key storage (proposal Phase 1)."""

import base64
import hashlib
import hmac
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import MASTER_KEY

_SALT_LEN = 16
_NONCE_LEN = 12
_ITERATIONS = 200_000


def _derive_key(master: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", master.encode("utf-8"), salt, _ITERATIONS, dklen=32)


def encrypt_secret(plaintext: str, master: str = MASTER_KEY) -> str:
    """Encrypt a secret with AES-256-GCM.

    Layout (base64url): salt(16) | nonce(12) | tag(16) | ciphertext — fixed offsets,
    so random key material can never corrupt the framing.
    """
    salt = secrets.token_bytes(_SALT_LEN)
    nonce = secrets.token_bytes(_NONCE_LEN)
    key = _derive_key(master, salt)
    sealed = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    raw = salt + nonce + sealed
    return base64.urlsafe_b64encode(raw).decode("ascii")


def decrypt_secret(token: str, master: str = MASTER_KEY) -> str:
    raw = base64.urlsafe_b64decode(token.encode("ascii"))
    if len(raw) < _SALT_LEN + _NONCE_LEN + 16:
        raise ValueError("Encrypted payload is truncated")
    salt = raw[:_SALT_LEN]
    nonce = raw[_SALT_LEN : _SALT_LEN + _NONCE_LEN]
    sealed = raw[_SALT_LEN + _NONCE_LEN :]
    key = _derive_key(master, salt)
    plaintext = AESGCM(key).decrypt(nonce, sealed, None)
    return plaintext.decode("utf-8")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return f"pbkdf2${_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, digest_hex = stored.split("$")
        if algo != "pbkdf2":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(iterations), dklen=len(expected)
        )
        return hmac.compare_digest(candidate, expected)
    except (ValueError, TypeError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(32)
