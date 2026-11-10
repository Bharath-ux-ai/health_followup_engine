import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select

from app.api.deps import Ctx, owned, require
from app.models import Appointment, FollowUp, FollowUpContact, Patient, User, WhatsAppMessage
from app.schemas import serializers as ser
from app.schemas.requests import PatientUpdateIn
from app.services import audit, patients, reminders, views
from app.services.errors import Conflict
from app.services.phone import normalize_phone

router = APIRouter(prefix="/patients", tags=["patients"])


@router.get("")
def list_patients(ctx: Ctx = Depends(require("patients.view")), q: str | None = Query(None, max_length=80),
                  page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)):
    stmt = select(Patient).where(Patient.hospital_id == ctx.hospital.id, Patient.deleted_at.is_(None))
    if q:
        digits = "".join(c for c in q if c.isdigit())
        conds = [func.lower(Patient.full_name).like(f"%{q.strip().lower()}%")]
        if len(digits) >= 4:
            conds.append(Patient.phone.like(f"%{digits}%"))
        stmt = stmt.where(or_(*conds))
    total = ctx.db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = ctx.db.scalars(stmt.order_by(Patient.full_name).offset((page - 1) * page_size).limit(page_size)).all()
    ids = [p.id for p in rows]
    stats = {}
    if ids:
        for pid, n, last in ctx.db.execute(select(Appointment.patient_id, func.count(), func.max(Appointment.scheduled_date))
                                           .where(Appointment.patient_id.in_(ids)).group_by(Appointment.patient_id)):
            stats[pid] = {"appointments": n, "last_visit": last.isoformat() if last else None}
    return {"items": [{**ser.patient(p), **stats.get(p.id, {"appointments": 0, "last_visit": None})} for p in rows],
            "total": total, "page": page, "page_size": page_size}


@router.get("/{patient_id}")
def detail(patient_id: uuid.UUID, ctx: Ctx = Depends(require("patients.view"))):
    p = owned(ctx.db.get(Patient, patient_id), ctx, "Patient")
    appts = ctx.db.scalars(select(Appointment).where(Appointment.patient_id == p.id)
                           .order_by(Appointment.scheduled_date.desc(), Appointment.start_time.desc())).all()
    fus = ctx.db.scalars(select(FollowUp).where(FollowUp.patient_id == p.id).order_by(FollowUp.due_date.desc())).all()
    contacts = ctx.db.execute(select(FollowUpContact, User.full_name).outerjoin(User, User.id == FollowUpContact.user_id)
                              .where(FollowUpContact.followup_id.in_([f.id for f in fus] or [uuid.uuid4()]))
                              .order_by(FollowUpContact.contacted_at.desc())).all()
    msg_count = ctx.db.scalar(select(func.count()).select_from(WhatsAppMessage).where(WhatsAppMessage.patient_id == p.id))
    audit.record(ctx.db, "patient.viewed", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="patient", entity_id=p.id, ip=ctx.ip)
    ctx.db.commit()
    return {**ser.patient(p), "appointments": views.appointments_out(ctx.db, list(appts)),
            "followups": views.followups_out(ctx.db, ctx.hospital, list(fus)),
            "contacts": [{**ser.contact(c, by), "followup_id": str(c.followup_id)} for c, by in contacts],
            "message_count": msg_count}


@router.patch("/{patient_id}")
def update(patient_id: uuid.UUID, body: PatientUpdateIn, ctx: Ctx = Depends(require("patients.manage"))):
    p = owned(ctx.db.get(Patient, patient_id), ctx, "Patient")
    changes = body.model_dump(exclude_none=True)
    if "full_name" in changes or "phone" in changes:
        name = patients.clean_name(changes.get("full_name", p.full_name))
        phone = normalize_phone(changes["phone"]) if "phone" in changes else p.phone
        key = patients.name_key(name)
        clash = ctx.db.scalar(select(Patient.id).where(Patient.hospital_id == p.hospital_id, Patient.phone == phone,
                                                       Patient.name_key == key, Patient.id != p.id, Patient.deleted_at.is_(None)))
        if clash:
            raise Conflict("Another patient record already has this name and phone number")
        p.full_name, p.phone, p.name_key = name, phone, key
    if "preferred_language" in changes:
        p.preferred_language = changes["preferred_language"]
    if "whatsapp_consent" in changes and changes["whatsapp_consent"] != p.whatsapp_consent:
        patients.set_consent(ctx.db, ctx.hospital, p, changes["whatsapp_consent"], "staff")
    audit.record(ctx.db, "patient.updated", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="patient",
                 entity_id=p.id, details={"fields": sorted(changes)})
    ctx.db.commit()
    return ser.patient(p)


@router.delete("/{patient_id}")
def remove(patient_id: uuid.UUID, ctx: Ctx = Depends(require("patients.manage", "hospital.staff.manage"))):
    """Soft delete (admin only). Pending reminders are cancelled; history is kept for reporting integrity."""
    p = owned(ctx.db.get(Patient, patient_id), ctx, "Patient")
    from app.db.base import utcnow
    p.deleted_at = utcnow()
    reminders.cancel_for_patient(ctx.db, p.id, "Patient record removed")
    audit.record(ctx.db, "patient.deleted", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="patient", entity_id=p.id)
    ctx.db.commit()
    return {"ok": True}
