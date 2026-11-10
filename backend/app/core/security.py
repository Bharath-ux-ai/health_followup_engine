"""Password hashing, session tokens, signed links and at-rest encryption."""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings

ALGORITHM = "HS256"


# ---- Passwords -------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def validate_password_strength(password: str) -> None:
    if len(password) < 10:
        raise ValueError("Password must be at least 10 characters")
    if password.isdigit() or password.isalpha():
        raise ValueError("Password must contain both letters and numbers")


# ---- Session tokens --------------------------------------------------------
def create_access_token(user_id: uuid.UUID, token_version: int) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "ver": token_version,
        "typ": "session",
        "iat": now,
        "exp": now + timedelta(minutes=s.ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, s.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, get_settings().SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    return payload if payload.get("typ") == "session" else None


# ---- Patient action links (reschedule) ---------------------------------------
def create_action_token(kind: str, entity_id: uuid.UUID, expires_at: datetime) -> str:
    """Signed, expiring link token. Carries only an opaque id — no patient data."""
    payload = {"typ": "action", "k": kind, "id": str(entity_id), "exp": expires_at}
    return jwt.encode(payload, get_settings().SECRET_KEY, algorithm=ALGORITHM)


def decode_action_token(token: str) -> tuple[str, uuid.UUID] | None:
    try:
        payload = jwt.decode(token, get_settings().SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "action":
            return None
        return payload["k"], uuid.UUID(payload["id"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


# ---- Opaque random tokens (password reset) ---------------------------------
def new_random_token() -> tuple[str, str]:
    """Returns (token_for_user, sha256_hash_for_storage)."""
    token = secrets.token_urlsafe(32)
    return token, sha256(token)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


# ---- Encryption at rest ------------------------------------------------------
def _fernet() -> Fernet:
    return Fernet(get_settings().ENCRYPTION_KEY.encode("utf-8"))


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    return f"••••{value[-4:]}" if len(value) > 8 else "••••"
