"""Unauthenticated endpoints: the shareable booking page and patient reschedule links.
They never return other patients' information — only availability (free/taken times) and the caller's own booking."""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip
from app.core.ratelimit import booking_limiter
from app.core.security import decode_action_token
from app.db.session import get_db
from app.models import Doctor, Hospital
from app.models.enums import AppointmentSource
from app.schemas import serializers as ser
from app.schemas.requests import PublicBookingIn, PublicRescheduleIn
from app.services import appointments, clock, patients, scheduling
from app.services.whatsapp import inbound

router = APIRouter(prefix="/public", tags=["public"])


def _hospital(db: Session, slug: str) -> Hospital:
    h = db.scalar(select(Hospital).where(Hospital.slug == slug, Hospital.deleted_at.is_(None)))
    if not h or not h.is_active:
        raise HTTPException(404, "Booking page not found")
    return h


def _doctors(db: Session, h: Hospital) -> list[Doctor]:
    return list(db.scalars(select(Doctor).where(Doctor.hospital_id == h.id, Doctor.is_active.is_(True),
                                                Doctor.deleted_at.is_(None)).order_by(Doctor.name)))


def _weekdays(d: Doctor) -> list[int]:
    return sorted({w.weekday for w in d.availability})


@router.get("/hospitals/{slug}")
def hospital_page(slug: str, db: Session = Depends(get_db)):
    h = _hospital(db, slug)
    return {**ser.hospital_public(h),
            "doctors": [{"id": str(d.id), "name": d.name, "specialty": d.specialty, "weekdays": _weekdays(d)} for d in _doctors(db, h)]}


@router.get("/hospitals/{slug}/slots")
def hospital_slots(slug: str, doctor_id: uuid.UUID, on: date = Query(alias="date"), db: Session = Depends(get_db)):
    h = _hospital(db, slug)
    doctor = scheduling.get_doctor(db, h, doctor_id)
    return {"date": on.isoformat(), "slots": scheduling.available_slots(db, h, doctor, on)}


@router.post("/hospitals/{slug}/appointments", status_code=201)
def book(slug: str, body: PublicBookingIn, request: Request, db: Session = Depends(get_db)):
    h = _hospital(db, slug)
    if not h.booking_enabled:
        raise HTTPException(403, "Online booking is currently closed. Please call the hospital.")
    if not booking_limiter.allow(f"{client_ip(request)}|{slug}"):
        raise HTTPException(429, "Too many booking attempts. Please try again later.")
    p = patients.find_or_create(db, h, full_name=body.full_name, phone=body.phone, language=body.language,
                                consent=body.whatsapp_consent, consent_source="booking_form")
    appt = appointments.book(db, h, patient=p, doctor_id=body.doctor_id, d=body.date, start_time=body.start_time,
                             source=AppointmentSource.online)
    db.commit()
    return {"reference": appt.reference, "date": appt.scheduled_date.isoformat(), "start_time": appt.start_time.strftime("%H:%M"),
            "doctor": appt.doctor.name, "hospital": h.name, "address": h.address, "phone": h.phone,
            "whatsapp_reminder": p.whatsapp_consent}


# ---- reschedule links ------------------------------------------------------------------------------
def _decode(token: str):
    decoded = decode_action_token(token)
    if not decoded:
        raise HTTPException(404, "This link is invalid or has expired")
    return decoded


@router.get("/actions/{token}")
def action_info(token: str, db: Session = Depends(get_db)):
    kind, eid = _decode(token)
    h, appt, fu = inbound.load_action(db, kind, eid)
    doctor = appt.doctor if appt else fu.doctor
    return {
        "kind": kind, "hospital": {"name": h.name, "phone": h.phone, "slug": h.slug},
        "doctor": {"id": str(doctor.id), "name": doctor.name, "specialty": doctor.specialty, "weekdays": _weekdays(doctor)},
        "current": {"reference": appt.reference, "date": appt.scheduled_date.isoformat(), "start_time": appt.start_time.strftime("%H:%M")} if appt else None,
        "followup_due": fu.due_date.isoformat() if fu else None,
        "today": clock.today(h).isoformat(), "booking_window_days": max(h.booking_window_days, 60),
    }


@router.get("/actions/{token}/slots")
def action_slots(token: str, on: date = Query(alias="date"), db: Session = Depends(get_db)):
    kind, eid = _decode(token)
    h, appt, fu = inbound.load_action(db, kind, eid)
    doctor = appt.doctor if appt else fu.doctor
    return {"date": on.isoformat(), "slots": scheduling.available_slots(db, h, doctor, on, enforce_window=False)}


@router.post("/actions/{token}/reschedule")
def action_reschedule(token: str, body: PublicRescheduleIn, request: Request, db: Session = Depends(get_db)):
    if not booking_limiter.allow(f"{client_ip(request)}|resched"):
        raise HTTPException(429, "Too many attempts. Please try again later.")
    kind, eid = _decode(token)
    appt = inbound.reschedule_via_link(db, kind, eid, body.date, body.start_time)
    db.commit()
    return {"reference": appt.reference, "date": appt.scheduled_date.isoformat(),
            "start_time": appt.start_time.strftime("%H:%M"), "doctor": appt.doctor.name}
