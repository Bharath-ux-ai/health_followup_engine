"""Authentication, authorisation and tenant scoping for API routes."""
import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import Hospital, User

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_HEADER = "x-requested-with"


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown"))[:64]


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    s = get_settings()
    token, via_cookie = None, False
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:]
    elif request.cookies.get(s.SESSION_COOKIE_NAME):
        token, via_cookie = request.cookies[s.SESSION_COOKIE_NAME], True
    if not token:
        raise HTTPException(401, "Not signed in")
    # CSRF: cookie-authenticated state changes must carry a custom header, which cross-site forms cannot set.
    if via_cookie and request.method not in SAFE_METHODS and request.headers.get(CSRF_HEADER) != "tectha":
        raise HTTPException(403, "Missing CSRF header")
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(401, "Session expired — please sign in again")
    try:
        user = db.get(User, uuid.UUID(payload["sub"]))
    except (KeyError, ValueError):
        raise HTTPException(401, "Invalid session")
    if not user or not user.is_active or user.deleted_at or user.token_version != payload.get("ver"):
        raise HTTPException(401, "Session is no longer valid")
    if user.hospital_id and (not user.hospital or not user.hospital.is_active or user.hospital.deleted_at):
        raise HTTPException(403, "This hospital account is suspended")
    return user


@dataclass
class Ctx:
    user: User
    hospital: Hospital
    ip: str
    db: Session


def require(*perms: str):
    """Dependency for hospital-scoped routes: checks permissions and returns the caller's own hospital."""

    def dep(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Ctx:
        missing = set(perms) - user.role.permission_codes
        if missing:
            raise HTTPException(403, "You do not have permission to do this")
        if user.hospital_id is None:
            raise HTTPException(403, "This action is only available to hospital accounts")
        hospital = db.get(Hospital, user.hospital_id)
        return Ctx(user=user, hospital=hospital, ip=client_ip(request), db=db)

    return dep


def require_platform(*perms: str):
    def dep(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Ctx:
        if user.hospital_id is not None or set(perms) - user.role.permission_codes:
            raise HTTPException(403, "System administrator access required")
        return Ctx(user=user, hospital=None, ip=client_ip(request), db=db)  # type: ignore[arg-type]

    return dep


def owned(obj, ctx: Ctx, label: str = "Record"):
    """Tenant isolation: anything outside the caller's hospital is reported as not found."""
    if obj is None or getattr(obj, "hospital_id", None) != ctx.hospital.id or getattr(obj, "deleted_at", None):
        raise HTTPException(404, f"{label} not found")
    return obj
