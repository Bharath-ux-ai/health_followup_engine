"""Hospital-admin routes: profile, doctors & schedules, staff, WhatsApp configuration, templates, audit log."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Ctx, owned, require
from app.core.permissions import HOSPITAL_ADMIN
from app.core.security import decrypt_secret, encrypt_secret, hash_password, mask_secret, validate_password_strength
from app.db.base import utcnow
from app.models import AuditLog, Doctor, DoctorAvailability, MessageTemplate, User, WhatsAppConfig
from app.models.enums import TemplateApproval, WhatsAppMode
from app.schemas import serializers as ser
from app.schemas.requests import (
    DoctorIn, HospitalUpdateIn, StaffCreateIn, StaffPasswordIn, StaffUpdateIn, TemplateUpdateIn, TestMessageIn,
    WhatsAppConfigIn,
)
from app.services import audit, onboarding
from app.services.errors import InvalidInput
from app.services.phone import normalize_phone
from app.services.whatsapp import outbound, templates as tpl
from app.services.whatsapp.provider import CloudApiProvider

router = APIRouter(tags=["administration"])


# ---- hospital profile --------------------------------------------------------------------
@router.get("/hospital")
def get_hospital(ctx: Ctx = Depends(require("appointments.view"))):
    return ser.hospital(ctx.hospital)


@router.patch("/hospital")
def update_hospital(body: HospitalUpdateIn, ctx: Ctx = Depends(require("hospital.profile.manage"))):
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes and not changes["name"]:
        raise InvalidInput("Hospital name is required")
    for k, v in changes.items():
        setattr(ctx.hospital, k, v)
    audit.record(ctx.db, "hospital.updated", hospital_id=ctx.hospital.id, user_id=ctx.user.id, details={"fields": sorted(changes)})
    ctx.db.commit()
    return ser.hospital(ctx.hospital)


# ---- doctors & availability ------------------------------------------------------------------
@router.get("/doctors")
def list_doctors(ctx: Ctx = Depends(require("appointments.view")), include_inactive: bool = False):
    stmt = select(Doctor).where(Doctor.hospital_id == ctx.hospital.id, Doctor.deleted_at.is_(None))
    if not include_inactive:
        stmt = stmt.where(Doctor.is_active.is_(True))
    return [ser.doctor(d) for d in ctx.db.scalars(stmt.order_by(Doctor.name))]


def _apply_doctor(db: Session, ctx: Ctx, doc: Doctor, body: DoctorIn) -> None:
    for w in body.availability:
        if w.end_time <= w.start_time:
            raise InvalidInput("Each consultation window must end after it starts")
    by_day: dict[int, list] = {}
    for w in sorted(body.availability, key=lambda w: (w.weekday, w.start_time)):
        prev = by_day.setdefault(w.weekday, [])
        if prev and prev[-1].end_time > w.start_time:
            raise InvalidInput("Consultation windows on the same day must not overlap")
        prev.append(w)
    doc.name, doc.specialty, doc.is_active = body.name, body.specialty, body.is_active
    doc.availability.clear()
    db.flush()
    doc.availability.extend(DoctorAvailability(hospital_id=ctx.hospital.id, weekday=w.weekday, start_time=w.start_time,
                                               end_time=w.end_time, slot_minutes=w.slot_minutes) for w in body.availability)


@router.post("/doctors", status_code=201)
def create_doctor(body: DoctorIn, ctx: Ctx = Depends(require("hospital.schedule.manage"))):
    doc = Doctor(hospital_id=ctx.hospital.id, name=body.name)
    ctx.db.add(doc)
    _apply_doctor(ctx.db, ctx, doc, body)
    audit.record(ctx.db, "doctor.created", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="doctor", entity_id=doc.id)
    ctx.db.commit()
    return ser.doctor(doc)


@router.put("/doctors/{doctor_id}")
def update_doctor(doctor_id: uuid.UUID, body: DoctorIn, ctx: Ctx = Depends(require("hospital.schedule.manage"))):
    doc = owned(ctx.db.get(Doctor, doctor_id), ctx, "Doctor")
    _apply_doctor(ctx.db, ctx, doc, body)
    audit.record(ctx.db, "doctor.updated", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="doctor", entity_id=doc.id)
    ctx.db.commit()
    return ser.doctor(doc)


@router.delete("/doctors/{doctor_id}")
def delete_doctor(doctor_id: uuid.UUID, ctx: Ctx = Depends(require("hospital.schedule.manage"))):
    doc = owned(ctx.db.get(Doctor, doctor_id), ctx, "Doctor")
    doc.deleted_at, doc.is_active = utcnow(), False  # soft delete: existing appointments keep their doctor
    audit.record(ctx.db, "doctor.deleted", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="doctor", entity_id=doc.id)
    ctx.db.commit()
    return {"ok": True}


# ---- staff ---------------------------------------------------------------------------------------
@router.get("/staff")
def list_staff(ctx: Ctx = Depends(require("hospital.staff.manage"))):
    rows = ctx.db.scalars(select(User).where(User.hospital_id == ctx.hospital.id, User.deleted_at.is_(None)).order_by(User.full_name))
    return [ser.user(u) for u in rows]


@router.post("/staff", status_code=201)
def create_staff(body: StaffCreateIn, ctx: Ctx = Depends(require("hospital.staff.manage"))):
    u = onboarding.create_user(ctx.db, email=body.email, full_name=body.full_name, password=body.password,
                               role_code=body.role, hospital=ctx.hospital)
    audit.record(ctx.db, "staff.created", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="user", entity_id=u.id,
                 details={"role": body.role})
    ctx.db.commit()
    return ser.user(u)


def _staff(ctx: Ctx, user_id: uuid.UUID) -> User:
    u = ctx.db.get(User, user_id)
    if not u or u.hospital_id != ctx.hospital.id or u.deleted_at:
        raise HTTPException(404, "Staff member not found")
    return u


def _ensure_another_admin(ctx: Ctx, u: User) -> None:
    others = ctx.db.scalar(select(func.count()).select_from(User).where(
        User.hospital_id == ctx.hospital.id, User.id != u.id, User.is_active.is_(True), User.deleted_at.is_(None),
        User.role_id == onboarding.role(ctx.db, HOSPITAL_ADMIN).id))
    if not others:
        raise InvalidInput("The hospital must keep at least one active admin")


@router.patch("/staff/{user_id}")
def update_staff(user_id: uuid.UUID, body: StaffUpdateIn, ctx: Ctx = Depends(require("hospital.staff.manage"))):
    u = _staff(ctx, user_id)
    if u.role.code == HOSPITAL_ADMIN and ((body.role and body.role != HOSPITAL_ADMIN) or body.is_active is False):
        _ensure_another_admin(ctx, u)
    if body.full_name:
        u.full_name = body.full_name
    if body.role:
        u.role = onboarding.role(ctx.db, body.role)
        u.token_version += 1
    if body.is_active is not None:
        u.is_active = body.is_active
        if not body.is_active:
            u.token_version += 1  # signs the user out immediately
    audit.record(ctx.db, "staff.updated", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="user", entity_id=u.id,
                 details=body.model_dump(exclude_none=True))
    ctx.db.commit()
    return ser.user(u)


@router.post("/staff/{user_id}/password")
def reset_staff_password(user_id: uuid.UUID, body: StaffPasswordIn, ctx: Ctx = Depends(require("hospital.staff.manage"))):
    u = _staff(ctx, user_id)
    try:
        validate_password_strength(body.password)
    except ValueError as exc:
        raise InvalidInput(str(exc))
    u.password_hash, u.token_version, u.failed_logins, u.locked_until = hash_password(body.password), u.token_version + 1, 0, None
    audit.record(ctx.db, "staff.password_reset", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="user", entity_id=u.id)
    ctx.db.commit()
    return {"ok": True}


# ---- WhatsApp configuration ----------------------------------------------------------------------------
def _config_out(cfg: WhatsAppConfig) -> dict:
    token = decrypt_secret(cfg.access_token_enc)
    from app.core.config import get_settings
    s = get_settings()
    return {
        "mode": cfg.mode.value, "phone_number_id": cfg.phone_number_id, "waba_id": cfg.waba_id,
        "display_phone_number": cfg.display_phone_number, "verified_name": cfg.verified_name,
        "access_token_set": bool(token), "access_token_hint": mask_secret(token),
        "app_secret_set": bool(cfg.app_secret_enc), "last_verified_at": cfg.last_verified_at.isoformat() if cfg.last_verified_at else None,
        "last_error": cfg.last_error,
        "webhook_url": f"{s.PUBLIC_APP_URL.rstrip('/')}/api/webhooks/whatsapp",
        "verify_token_configured": bool(s.WHATSAPP_VERIFY_TOKEN), "platform_app_secret_configured": bool(s.META_APP_SECRET),
        "api_version": s.WHATSAPP_API_VERSION,
        "ready_for_live": bool(cfg.phone_number_id and token and (cfg.app_secret_enc or s.META_APP_SECRET) and s.WHATSAPP_VERIFY_TOKEN),
    }


@router.get("/whatsapp/config")
def get_whatsapp_config(ctx: Ctx = Depends(require("hospital.whatsapp.manage"))):
    cfg = outbound.get_config(ctx.db, ctx.hospital)
    ctx.db.commit()
    return _config_out(cfg)


@router.put("/whatsapp/config")
def update_whatsapp_config(body: WhatsAppConfigIn, ctx: Ctx = Depends(require("hospital.whatsapp.manage"))):
    cfg = outbound.get_config(ctx.db, ctx.hospital)
    if body.phone_number_id is not None:
        if body.phone_number_id and ctx.db.scalar(select(WhatsAppConfig.id).where(
                WhatsAppConfig.phone_number_id == body.phone_number_id, WhatsAppConfig.id != cfg.id)):
            raise InvalidInput("This phone number ID is already connected to another hospital")
        cfg.phone_number_id = body.phone_number_id or None
    if body.waba_id is not None:
        cfg.waba_id = body.waba_id or None
    if body.access_token:
        cfg.access_token_enc = encrypt_secret(body.access_token)
    if body.app_secret:
        cfg.app_secret_enc = encrypt_secret(body.app_secret)
    if body.mode:
        if body.mode == WhatsAppMode.live and not (cfg.phone_number_id and cfg.access_token_enc):
            raise InvalidInput("Enter the phone number ID and access token before switching to live mode")
        cfg.mode = body.mode
    audit.record(ctx.db, "whatsapp.config_updated", hospital_id=ctx.hospital.id, user_id=ctx.user.id,
                 details={"mode": cfg.mode.value, "token_changed": bool(body.access_token), "secret_changed": bool(body.app_secret)})
    ctx.db.commit()
    return _config_out(cfg)


def _cloud(cfg: WhatsAppConfig) -> CloudApiProvider:
    token = decrypt_secret(cfg.access_token_enc)
    if not cfg.phone_number_id or not token:
        raise InvalidInput("Enter the phone number ID and access token first")
    return CloudApiProvider(cfg.phone_number_id, token, transport=outbound.transport_override)


@router.post("/whatsapp/config/verify")
def verify_whatsapp(ctx: Ctx = Depends(require("hospital.whatsapp.manage"))):
    """Calls the Cloud API with the saved credentials to confirm they work."""
    cfg = outbound.get_config(ctx.db, ctx.hospital)
    try:
        info = _cloud(cfg).verify()
    except RuntimeError as exc:
        cfg.last_error = f"Verification failed: {exc}"[:400]
        ctx.db.commit()
        raise InvalidInput(cfg.last_error)
    cfg.display_phone_number, cfg.verified_name = info.get("display_phone_number"), info.get("verified_name")
    cfg.last_verified_at, cfg.last_error = utcnow(), None
    audit.record(ctx.db, "whatsapp.verified", hospital_id=ctx.hospital.id, user_id=ctx.user.id)
    ctx.db.commit()
    return _config_out(cfg)


@router.post("/whatsapp/test-message")
def test_message(body: TestMessageIn, ctx: Ctx = Depends(require("hospital.whatsapp.manage"))):
    cfg = outbound.get_config(ctx.db, ctx.hospital)
    if cfg.mode != WhatsAppMode.live:
        raise InvalidInput("Switch to live mode to send a real test message")
    msg = outbound.send_test_message(ctx.db, ctx.hospital, normalize_phone(body.phone))
    audit.record(ctx.db, "whatsapp.test_message", hospital_id=ctx.hospital.id, user_id=ctx.user.id, details={"status": msg.status.value})
    ctx.db.commit()
    return ser.message(msg)


# ---- templates ------------------------------------------------------------------------------------------
@router.get("/whatsapp/templates")
def list_templates(ctx: Ctx = Depends(require("hospital.whatsapp.manage"))):
    tpl.seed_defaults(ctx.db, ctx.hospital)
    ctx.db.commit()
    rows = ctx.db.scalars(select(MessageTemplate).where(MessageTemplate.hospital_id == ctx.hospital.id)
                          .order_by(MessageTemplate.purpose, MessageTemplate.language)).all()
    return {"items": [ser.template(t) for t in rows],
            "parameters": {k.value: v for k, v in tpl.TEMPLATE_PARAMS.items()}, "reply_placeholders": tpl.REPLY_PLACEHOLDERS}


@router.put("/whatsapp/templates/{template_id}")
def update_template(template_id: uuid.UUID, body: TemplateUpdateIn, ctx: Ctx = Depends(require("hospital.whatsapp.manage"))):
    t = ctx.db.get(MessageTemplate, template_id)
    if not t or t.hospital_id != ctx.hospital.id:
        raise HTTPException(404, "Template not found")
    is_meta = t.purpose in tpl.META_TEMPLATE_PURPOSES
    if body.body is not None:
        tpl.validate_body(t.purpose, body.body)
        if is_meta and body.body != t.body:
            t.approval_status = TemplateApproval.not_submitted  # edited text needs fresh Meta approval
        t.body = body.body
    if is_meta:
        for field in ("meta_name", "confirm_label", "reschedule_label"):
            if getattr(body, field) is not None:
                setattr(t, field, getattr(body, field))
        if body.approval_status is not None:
            if body.approval_status == TemplateApproval.not_required:
                raise InvalidInput("Reminder templates always need Meta approval")
            t.approval_status = body.approval_status
    audit.record(ctx.db, "template.updated", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="template", entity_id=t.id)
    ctx.db.commit()
    return ser.template(t)


@router.post("/whatsapp/templates/reset/{template_id}")
def reset_template(template_id: uuid.UUID, ctx: Ctx = Depends(require("hospital.whatsapp.manage"))):
    t = ctx.db.get(MessageTemplate, template_id)
    if not t or t.hospital_id != ctx.hospital.id:
        raise HTTPException(404, "Template not found")
    d = tpl.DEFAULTS[(t.purpose, t.language)]
    t.body = d["body"]
    if t.purpose in tpl.META_TEMPLATE_PURPOSES:
        t.meta_name, t.confirm_label, t.reschedule_label = d["meta_name"], d["confirm_label"], d["reschedule_label"]
        t.approval_status = TemplateApproval.not_submitted
    ctx.db.commit()
    return ser.template(t)


@router.post("/whatsapp/templates/sync")
def sync_templates(ctx: Ctx = Depends(require("hospital.whatsapp.manage"))):
    """Pull approval status of our templates from WhatsApp Manager (requires WABA ID + token)."""
    cfg = outbound.get_config(ctx.db, ctx.hospital)
    if not cfg.waba_id:
        raise InvalidInput("Enter the WhatsApp Business Account ID first")
    try:
        remote = _cloud(cfg).list_templates(cfg.waba_id)
    except RuntimeError as exc:
        raise InvalidInput(f"Could not fetch templates: {exc}")
    status_map = {"APPROVED": TemplateApproval.approved, "PENDING": TemplateApproval.pending, "REJECTED": TemplateApproval.rejected,
                  "IN_APPEAL": TemplateApproval.pending, "PAUSED": TemplateApproval.rejected, "DISABLED": TemplateApproval.rejected}
    index = {(r.get("name"), r.get("language")): r.get("status") for r in remote}
    updated = 0
    for t in ctx.db.scalars(select(MessageTemplate).where(MessageTemplate.hospital_id == ctx.hospital.id)):
        if t.purpose not in tpl.META_TEMPLATE_PURPOSES:
            continue
        st = index.get((t.meta_name, t.meta_language_code))
        t.approval_status = status_map.get(st, TemplateApproval.not_submitted) if st else TemplateApproval.not_submitted
        t.last_synced_at = utcnow()
        updated += 1
    ctx.db.commit()
    return {"updated": updated, "remote_templates": len(remote)}


# ---- audit ----------------------------------------------------------------------------------------------------
@router.get("/audit")
def audit_log(ctx: Ctx = Depends(require("hospital.audit.view")), page: int = Query(1, ge=1)):
    rows = ctx.db.execute(select(AuditLog, User.full_name).outerjoin(User, User.id == AuditLog.user_id)
                          .where(AuditLog.hospital_id == ctx.hospital.id).order_by(AuditLog.created_at.desc())
                          .offset((page - 1) * 50).limit(50)).all()
    return [{"action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id, "details": a.details,
             "user": name, "ip": a.ip_address, "at": a.created_at.isoformat()} for a, name in rows]
