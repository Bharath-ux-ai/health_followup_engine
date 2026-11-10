from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import client_ip, current_user
from app.core.config import get_settings
from app.core.ratelimit import forgot_limiter, login_limiter
from app.core.security import (
    create_access_token, hash_password, new_random_token, sha256, validate_password_strength, verify_password,
)
from app.db.base import utcnow
from app.db.session import get_db
from app.models import PasswordResetToken, User
from app.schemas import serializers as ser
from app.schemas.requests import ChangePasswordIn, ForgotPasswordIn, LoginIn, ResetPasswordIn
from app.services import audit, email

router = APIRouter(prefix="/auth", tags=["auth"])
GENERIC_LOGIN_ERROR = "Incorrect email or password"


def _set_session(response: Response, user: User) -> None:
    s = get_settings()
    response.set_cookie(
        s.SESSION_COOKIE_NAME, create_access_token(user.id, user.token_version), max_age=s.ACCESS_TOKEN_MINUTES * 60,
        httponly=True, secure=s.COOKIE_SECURE, samesite="lax", path="/",
    )


def me_payload(user: User) -> dict:
    out = ser.user(user)
    out["hospital"] = ser.hospital(user.hospital) if user.hospital else None
    return out


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    s = get_settings()
    ip = client_ip(request)
    email_ = body.email.lower()
    if not login_limiter.allow(f"{ip}|{email_}"):
        raise HTTPException(429, "Too many attempts. Please wait a few minutes and try again.")
    user = db.scalar(select(User).where(User.email == email_, User.deleted_at.is_(None)))
    now = utcnow()
    if user and user.locked_until and user.locked_until > now:
        raise HTTPException(423, "Account temporarily locked after repeated failed sign-ins. Try again later or reset your password.")
    if not user or not verify_password(body.password, user.password_hash) or not user.is_active:
        if user:
            user.failed_logins += 1
            if user.failed_logins >= s.LOGIN_MAX_FAILURES:
                user.locked_until, user.failed_logins = now + timedelta(minutes=s.LOGIN_LOCK_MINUTES), 0
            audit.record(db, "auth.login_failed", hospital_id=user.hospital_id, user_id=user.id, ip=ip)
            db.commit()
        raise HTTPException(401, GENERIC_LOGIN_ERROR)
    if user.hospital and not user.hospital.is_active:
        raise HTTPException(403, "This hospital account is suspended")
    user.failed_logins, user.locked_until, user.last_login_at = 0, None, now
    audit.record(db, "auth.login", hospital_id=user.hospital_id, user_id=user.id, ip=ip)
    db.commit()
    _set_session(response, user)
    return me_payload(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(get_settings().SESSION_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return me_payload(user)


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    if not forgot_limiter.allow(ip):
        raise HTTPException(429, "Too many requests. Please try again later.")
    user = db.scalar(select(User).where(User.email == body.email.lower(), User.deleted_at.is_(None), User.is_active.is_(True)))
    if user:
        token, token_hash = new_random_token()
        db.add(PasswordResetToken(user_id=user.id, token_hash=token_hash,
                                  expires_at=utcnow() + timedelta(minutes=get_settings().PASSWORD_RESET_MINUTES)))
        audit.record(db, "auth.password_reset_requested", hospital_id=user.hospital_id, user_id=user.id, ip=ip)
        db.commit()
        link = f"{get_settings().PUBLIC_APP_URL.rstrip('/')}/reset-password?token={token}"
        email.send(user.email, "Reset your TEC THA password",
                   f"Hello {user.full_name},\n\nUse this link within {get_settings().PASSWORD_RESET_MINUTES} minutes to set a new password:\n{link}\n\n"
                   "If you did not ask for this, you can ignore this email.")
    # Same response whether or not the account exists (no account enumeration).
    return {"ok": True, "message": "If that email belongs to an account, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(body: ResetPasswordIn, request: Request, db: Session = Depends(get_db)):
    try:
        validate_password_strength(body.password)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == sha256(body.token)))
    if not row or row.used_at or row.expires_at < utcnow():
        raise HTTPException(400, "This reset link is invalid or has expired")
    user = db.get(User, row.user_id)
    user.password_hash = hash_password(body.password)
    user.token_version += 1  # signs out every existing session
    user.failed_logins, user.locked_until = 0, None
    row.used_at = utcnow()
    db.execute(update(PasswordResetToken).where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
               .values(used_at=utcnow()))
    audit.record(db, "auth.password_reset", hospital_id=user.hospital_id, user_id=user.id, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.post("/change-password")
def change_password(body: ChangePasswordIn, request: Request, response: Response, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    try:
        validate_password_strength(body.new_password)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1
    audit.record(db, "auth.password_changed", hospital_id=user.hospital_id, user_id=user.id, ip=client_ip(request))
    db.commit()
    _set_session(response, user)
    return {"ok": True}
