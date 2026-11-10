import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select

from app.api.deps import Ctx, owned, require
from app.models import Appointment, Doctor, FollowUp, Patient, ReminderSchedule, WhatsAppMessage
from app.models.enums import AppointmentSource, AppointmentStatus
from app.schemas import serializers as ser
from app.schemas.requests import FollowUpCreateIn, RescheduleIn, StaffBookingIn, StatusIn
from app.services import appointments, audit, followups, patients, scheduling, views

router = APIRouter(prefix="/appointments", tags=["appointments"])


@router.get("")
def list_appointments(
    ctx: Ctx = Depends(require("appointments.view")),
    date_from: date | None = None, date_to: date | None = None,
    status: list[AppointmentStatus] = Query(default=[]), doctor_id: uuid.UUID | None = None,
    q: str | None = Query(None, max_length=80), page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
):
    stmt = select(Appointment).join(Patient).where(Appointment.hospital_id == ctx.hospital.id)
    if date_from:
        stmt = stmt.where(Appointment.scheduled_date >= date_from)
    if date_to:
        stmt = stmt.where(Appointment.scheduled_date <= date_to)
    if status:
        stmt = stmt.where(Appointment.status.in_(status))
    if doctor_id:
        stmt = stmt.where(Appointment.doctor_id == doctor_id)
    if q:
        like = f"%{q.strip().lower()}%"
        digits = "".join(c for c in q if c.isdigit())
        conds = [func.lower(Patient.full_name).like(like), func.lower(Appointment.reference).like(like)]
        if len(digits) >= 4:
            conds.append(Patient.phone.like(f"%{digits}%"))
        stmt = stmt.where(or_(*conds))
    total = ctx.db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = ctx.db.scalars(stmt.order_by(Appointment.scheduled_date.desc(), Appointment.start_time)
                          .offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": views.appointments_out(ctx.db, list(rows)), "total": total, "page": page, "page_size": page_size}


@router.get("/slots")
def slots(doctor_id: uuid.UUID, on: date = Query(alias="date"), ctx: Ctx = Depends(require("appointments.view"))):
    doctor = scheduling.get_doctor(ctx.db, ctx.hospital, doctor_id)
    return {"date": on.isoformat(), "slots": scheduling.available_slots(ctx.db, ctx.hospital, doctor, on, enforce_window=False)}


@router.get("/doctors")
def doctors(ctx: Ctx = Depends(require("appointments.view"))):
    rows = ctx.db.scalars(select(Doctor).where(Doctor.hospital_id == ctx.hospital.id, Doctor.deleted_at.is_(None),
                                               Doctor.is_active.is_(True)).order_by(Doctor.name))
    return [ser.doctor(d) for d in rows]


@router.post("", status_code=201)
def register(body: StaffBookingIn, ctx: Ctx = Depends(require("appointments.manage"))):
    p = patients.find_or_create(ctx.db, ctx.hospital, full_name=body.full_name, phone=body.phone, language=body.language,
                                consent=body.whatsapp_consent, consent_source="staff")
    appt = appointments.book(
        ctx.db, ctx.hospital, patient=p, doctor_id=body.doctor_id, d=body.date, start_time=body.start_time,
        source=AppointmentSource.staff, created_by=ctx.user.id, enforce_window=False,
        status=AppointmentStatus.confirmed if body.mark_confirmed else AppointmentStatus.booked,
        confirmed_via="staff" if body.mark_confirmed else None,
    )
    ctx.db.commit()
    return views.appointments_out(ctx.db, [appt])[0]


@router.get("/{appointment_id}")
def detail(appointment_id: uuid.UUID, ctx: Ctx = Depends(require("appointments.view"))):
    appt = owned(ctx.db.get(Appointment, appointment_id), ctx, "Appointment")
    out = views.appointments_out(ctx.db, [appt])[0]
    fu = ctx.db.scalar(select(FollowUp).where(FollowUp.source_appointment_id == appt.id).order_by(FollowUp.created_at.desc()).limit(1))
    out["followup"] = views.followups_out(ctx.db, ctx.hospital, [fu])[0] if fu else None
    linked = ctx.db.get(FollowUp, appt.followup_id) if appt.followup_id else None
    out["for_followup"] = {"id": str(linked.id), "due_date": linked.original_due_date.isoformat()} if linked else None
    rems = ctx.db.scalars(select(ReminderSchedule).where(ReminderSchedule.appointment_id == appt.id).order_by(ReminderSchedule.created_at)).all()
    out["reminders"] = [ser.reminder(r) for r in rems]
    msgs = ctx.db.scalars(select(WhatsAppMessage).where(WhatsAppMessage.appointment_id == appt.id).order_by(WhatsAppMessage.occurred_at)).all()
    out["messages"] = [ser.message(m) for m in msgs]
    audit.record(ctx.db, "appointment.viewed", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="appointment", entity_id=appt.id)
    ctx.db.commit()
    return out


@router.post("/{appointment_id}/status")
def set_status(appointment_id: uuid.UUID, body: StatusIn, ctx: Ctx = Depends(require("appointments.manage"))):
    appt = owned(ctx.db.get(Appointment, appointment_id), ctx, "Appointment")
    if body.status == AppointmentStatus.booked:
        raise HTTPException(422, "Use reschedule to move an appointment")
    appointments.change_status(ctx.db, ctx.hospital, appt, body.status, user_id=ctx.user.id, via="staff", reason=body.reason)
    ctx.db.commit()
    return views.appointments_out(ctx.db, [appt])[0]


@router.post("/{appointment_id}/reschedule")
def reschedule(appointment_id: uuid.UUID, body: RescheduleIn, ctx: Ctx = Depends(require("appointments.manage"))):
    appt = owned(ctx.db.get(Appointment, appointment_id), ctx, "Appointment")
    appointments.reschedule(ctx.db, ctx.hospital, appt, d=body.date, start_time=body.start_time, doctor_id=body.doctor_id,
                            user_id=ctx.user.id, via="staff", confirm=body.mark_confirmed)
    ctx.db.commit()
    return views.appointments_out(ctx.db, [appt])[0]


@router.post("/{appointment_id}/followup", status_code=201)
def create_followup(appointment_id: uuid.UUID, body: FollowUpCreateIn, ctx: Ctx = Depends(require("followups.manage"))):
    appt = owned(ctx.db.get(Appointment, appointment_id), ctx, "Appointment")
    fu = followups.create(ctx.db, ctx.hospital, appt, body.due_date, user_id=ctx.user.id)
    ctx.db.commit()
    return views.followups_out(ctx.db, ctx.hospital, [fu])[0]
