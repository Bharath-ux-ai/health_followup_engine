"""Roles/permissions seeding and hospital onboarding."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.permissions import HOSPITAL_ADMIN, PERMISSIONS, ROLES
from app.core.security import hash_password, validate_password_strength
from app.models import Hospital, Permission, Role, SystemSetting, User
from app.services import audit
from app.services.errors import Conflict, InvalidInput
from app.services.whatsapp import outbound, templates


def ensure_roles(db: Session) -> None:
    perms = {p.code: p for p in db.scalars(select(Permission))}
    for code, desc in PERMISSIONS.items():
        if code not in perms:
            perms[code] = Permission(code=code, description=desc)
            db.add(perms[code])
    db.flush()
    for code, spec in ROLES.items():
        role = db.scalar(select(Role).where(Role.code == code)) or Role(code=code, name=spec["name"])
        role.name = spec["name"]
        role.permissions = [perms[c] for c in spec["permissions"]]
        db.add(role)
    db.flush()


def role(db: Session, code: str) -> Role:
    r = db.scalar(select(Role).where(Role.code == code))
    if r is None:
        ensure_roles(db)
        r = db.scalar(select(Role).where(Role.code == code))
    return r


def create_user(db: Session, *, email: str, full_name: str, password: str, role_code: str, hospital: Hospital | None) -> User:
    try:
        validate_password_strength(password)
    except ValueError as exc:
        raise InvalidInput(str(exc))
    email = email.strip().lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise Conflict("A user with this email already exists")
    u = User(email=email, full_name=full_name.strip(), password_hash=hash_password(password), role=role(db, role_code),
             hospital_id=hospital.id if hospital else None)
    db.add(u)
    db.flush()
    return u


def platform_settings(db: Session) -> dict:
    row = db.get(SystemSetting, "platform")
    return dict(row.value) if row else {"default_timezone": "Asia/Kolkata", "default_reminder_time": "18:00"}


def create_hospital(
    db: Session, *, name: str, slug: str, admin_name: str, admin_email: str, admin_password: str,
    city: str | None = None, phone: str | None = None, is_demo: bool = False, actor_id=None,
) -> tuple[Hospital, User]:
    if db.scalar(select(Hospital.id).where(Hospital.slug == slug)):
        raise Conflict("That booking link name is already taken")
    ps = platform_settings(db)
    from datetime import time
    h = Hospital(name=name.strip(), slug=slug, city=city, phone=phone, is_demo=is_demo,
                 timezone=ps.get("default_timezone", "Asia/Kolkata"),
                 reminder_send_time=time.fromisoformat(ps.get("default_reminder_time", "18:00")))
    db.add(h)
    db.flush()
    admin = create_user(db, email=admin_email, full_name=admin_name, password=admin_password, role_code=HOSPITAL_ADMIN, hospital=h)
    templates.seed_defaults(db, h)
    outbound.get_config(db, h)  # starts in simulation mode until live credentials are entered
    audit.record(db, "hospital.onboarded", hospital_id=h.id, user_id=actor_id, entity_type="hospital", entity_id=h.id,
                 details={"slug": slug, "is_demo": is_demo})
    return h, admin
