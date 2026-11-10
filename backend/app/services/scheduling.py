"""Slot generation from weekly doctor availability."""
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Appointment, Doctor, Hospital
from app.services import clock
from app.services.errors import InvalidInput, NotFound

LEAD_MINUTES = 15  # same-day slots must start at least this far in the future


def get_doctor(db: Session, h: Hospital, doctor_id) -> Doctor:
    doctor = db.get(Doctor, doctor_id)
    if not doctor or doctor.hospital_id != h.id or doctor.deleted_at or not doctor.is_active:
        raise NotFound("Doctor not found")
    return doctor


def generate_slots(h: Hospital, doctor: Doctor, d: date) -> list[tuple[time, time]]:
    slots: list[tuple[time, time]] = []
    for w in doctor.availability:
        if w.weekday != d.weekday():
            continue
        step = timedelta(minutes=w.slot_minutes or h.slot_minutes)
        cur = datetime.combine(d, w.start_time)
        end = datetime.combine(d, w.end_time)
        while cur + step <= end:
            slots.append((cur.time(), (cur + step).time()))
            cur += step
    return sorted(set(slots))


def booking_window(h: Hospital) -> tuple[date, date]:
    today = clock.today(h)
    return today, today + timedelta(days=h.booking_window_days)


def validate_date(h: Hospital, d: date, *, enforce_window: bool = True) -> None:
    first, last = booking_window(h)
    if d < first:
        raise InvalidInput("That date is in the past")
    if enforce_window and d > last:
        raise InvalidInput(f"Bookings are open up to {h.booking_window_days} days ahead")


def taken_times(db: Session, doctor_id, d: date) -> set[time]:
    rows = db.scalars(select(Appointment.start_time).where(
        Appointment.doctor_id == doctor_id, Appointment.scheduled_date == d, Appointment.slot_key.is_not(None)
    ))
    return set(rows)


def available_slots(db: Session, h: Hospital, doctor: Doctor, d: date, *, enforce_window: bool = True) -> list[dict]:
    first, last = booking_window(h)
    if d < first or (enforce_window and d > last):
        return []
    taken = taken_times(db, doctor.id, d)
    cutoff = None
    if d == first:
        cutoff = (clock.local_now(h) + timedelta(minutes=LEAD_MINUTES)).time()
    out = []
    for start, end in generate_slots(h, doctor, d):
        if cutoff and start <= cutoff:
            continue
        out.append({"start_time": start.strftime("%H:%M"), "end_time": end.strftime("%H:%M"), "available": start not in taken})
    return out


def resolve_slot(db: Session, h: Hospital, doctor: Doctor, d: date, start: time, *, enforce_window: bool = True) -> tuple[time, time]:
    validate_date(h, d, enforce_window=enforce_window)
    for s, e in generate_slots(h, doctor, d):
        if s == start:
            if d == clock.today(h) and s <= (clock.local_now(h) + timedelta(minutes=LEAD_MINUTES)).time():
                raise InvalidInput("That time has already passed")
            return s, e
    raise InvalidInput(f"{doctor.name} is not available at that time")
