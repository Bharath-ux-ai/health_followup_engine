"""System-admin (platform) routes. Platform admins manage hospital accounts but never see patient records."""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, text

from app.api.deps import Ctx, require_platform
from app.core.config import get_settings
from app.db.base import utcnow
from app.models import Appointment, Hospital, ReminderSchedule, SystemSetting, User, WhatsAppConfig, WhatsAppMessage
from app.models.enums import MessageStatus, ReminderStatus
from app.schemas.requests import HospitalAdminPatchIn, HospitalOnboardIn, PlatformSettingsIn
from app.services import audit, onboarding

router = APIRouter(prefix="/system", tags=["system"])


def _hospital_row(ctx: Ctx, h: Hospital) -> dict:
    since = utcnow() - timedelta(days=30)
    count = lambda model, *w: ctx.db.scalar(select(func.count()).select_from(model).where(model.hospital_id == h.id, *w)) or 0  # noqa: E731
    cfg = ctx.db.scalar(select(WhatsAppConfig).where(WhatsAppConfig.hospital_id == h.id))
    return {
        "id": str(h.id), "name": h.name, "slug": h.slug, "city": h.city, "is_active": h.is_active, "is_demo": h.is_demo,
        "created_at": h.created_at.isoformat(), "users": count(User, User.deleted_at.is_(None)),
        "appointments_30d": count(Appointment, Appointment.created_at >= since),
        "messages_30d": count(WhatsAppMessage, WhatsAppMessage.created_at >= since),
        "failed_reminders": count(ReminderSchedule, ReminderSchedule.status == ReminderStatus.failed),
        "whatsapp_mode": cfg.mode.value if cfg else "simulation",
    }


@router.get("/hospitals")
def hospitals(ctx: Ctx = Depends(require_platform("platform.hospitals.manage"))):
    rows = ctx.db.scalars(select(Hospital).where(Hospital.deleted_at.is_(None)).order_by(Hospital.created_at.desc())).all()
    return [_hospital_row(ctx, h) for h in rows]


@router.post("/hospitals", status_code=201)
def onboard(body: HospitalOnboardIn, ctx: Ctx = Depends(require_platform("platform.hospitals.manage"))):
    h, admin = onboarding.create_hospital(ctx.db, name=body.name, slug=body.slug, city=body.city, phone=body.phone,
                                          admin_name=body.admin_name, admin_email=body.admin_email,
                                          admin_password=body.admin_password, actor_id=ctx.user.id)
    ctx.db.commit()
    return {**_hospital_row(ctx, h), "admin_email": admin.email}


@router.patch("/hospitals/{hospital_id}")
def update(hospital_id: uuid.UUID, body: HospitalAdminPatchIn, ctx: Ctx = Depends(require_platform("platform.hospitals.manage"))):
    h = ctx.db.get(Hospital, hospital_id)
    if not h or h.deleted_at:
        raise HTTPException(404, "Hospital not found")
    if body.is_active is not None:
        h.is_active = body.is_active
    audit.record(ctx.db, "hospital.status_changed", hospital_id=h.id, user_id=ctx.user.id, details={"is_active": h.is_active})
    ctx.db.commit()
    return _hospital_row(ctx, h)


@router.get("/status")
def status(ctx: Ctx = Depends(require_platform("platform.status.view"))):
    db_ok = True
    try:
        ctx.db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 - surfaced as status
        db_ok = False
    hb = ctx.db.get(SystemSetting, "worker_heartbeat")
    last = hb.value.get("at") if hb else None
    from datetime import datetime
    healthy = bool(last) and (utcnow() - datetime.fromisoformat(last)).total_seconds() < get_settings().WORKER_INTERVAL_SECONDS * 4
    day = utcnow() - timedelta(days=1)
    msg = lambda *w: ctx.db.scalar(select(func.count()).select_from(WhatsAppMessage).where(WhatsAppMessage.created_at >= day, *w)) or 0  # noqa: E731
    return {
        "database": "ok" if db_ok else "error",
        "worker": {"healthy": healthy, "last_heartbeat": last, "last_cycle": hb.value.get("totals") if hb else None},
        "reminders_pending": ctx.db.scalar(select(func.count()).select_from(ReminderSchedule).where(ReminderSchedule.status == ReminderStatus.pending)),
        "reminders_failed": ctx.db.scalar(select(func.count()).select_from(ReminderSchedule).where(ReminderSchedule.status == ReminderStatus.failed)),
        "messages_24h": {"sent": msg(WhatsAppMessage.status.in_([MessageStatus.sent, MessageStatus.delivered, MessageStatus.read])),
                         "failed": msg(WhatsAppMessage.status == MessageStatus.failed),
                         "simulated": msg(WhatsAppMessage.status == MessageStatus.simulated),
                         "received": msg(WhatsAppMessage.status == MessageStatus.received)},
        "hospitals": {"active": ctx.db.scalar(select(func.count()).select_from(Hospital).where(Hospital.is_active.is_(True), Hospital.deleted_at.is_(None))),
                      "total": ctx.db.scalar(select(func.count()).select_from(Hospital).where(Hospital.deleted_at.is_(None)))},
        "environment": get_settings().ENVIRONMENT, "demo_mode": get_settings().DEMO_MODE,
        "whatsapp_api_version": get_settings().WHATSAPP_API_VERSION,
        "webhook": {"verify_token_configured": bool(get_settings().WHATSAPP_VERIFY_TOKEN),
                    "app_secret_configured": bool(get_settings().META_APP_SECRET)},
    }


@router.get("/settings")
def get_settings_(ctx: Ctx = Depends(require_platform("platform.settings.manage"))):
    return onboarding.platform_settings(ctx.db)


@router.put("/settings")
def put_settings(body: PlatformSettingsIn, ctx: Ctx = Depends(require_platform("platform.settings.manage"))):
    if body.default_timezone:
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(body.default_timezone)
        except Exception:  # noqa: BLE001
            raise HTTPException(422, "Unknown timezone")
    current = onboarding.platform_settings(ctx.db)
    for k, v in body.model_dump(exclude_none=True).items():
        current[k] = v.strftime("%H:%M") if hasattr(v, "strftime") else v
    row = ctx.db.get(SystemSetting, "platform") or SystemSetting(key="platform", value={})
    row.value = current
    ctx.db.add(row)
    audit.record(ctx.db, "platform.settings_updated", user_id=ctx.user.id, details={"fields": sorted(body.model_dump(exclude_none=True))})
    ctx.db.commit()
    return current
