"""Appointment booking, status transitions and rescheduling."""
import secrets
import uuid
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Appointment, Hospital, Patient
from app.models.enums import ACTIVE_APPOINTMENT_STATUSES, AppointmentSource, AppointmentStatus as S
from app.services import audit, clock, reminders, scheduling
from app.services.errors import Conflict, InvalidInput

_REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I confusion when read over the phone

TRANSITIONS: dict[S, set[S]] = {
    S.booked: {S.confirmed, S.reschedule_requested, S.cancelled, S.completed, S.no_show},
    S.confirmed: {S.reschedule_requested, S.cancelled, S.completed, S.no_show},
    S.reschedule_requested: {S.confirmed, S.cancelled, S.completed, S.no_show},
    S.completed: {S.no_show},  # correction
    S.no_show: {S.completed},  # correction (patient arrived late)
    S.cancelled: set(),
}


def slot_key(doctor_id: uuid.UUID, d: date, t: time) -> str:
    return f"{doctor_id}|{d.isoformat()}|{t.strftime('%H:%M')}"


def _new_reference(db: Session) -> str:
    while True:
        ref = "TT-" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(6))
        if not db.scalar(select(Appointment.id).where(Appointment.reference == ref)):
            return ref


def _claim_slot(db: Session, appt: Appointment, key: str) -> None:
    """Set the slot key inside a savepoint; the unique constraint makes double booking impossible."""
    try:
        with db.begin_nested():
            appt.slot_key = key
            db.add(appt)
            db.flush()
    except IntegrityError:
        raise Conflict("Sorry, that slot was just booked. Please choose another time.", code="slot_taken")


def book(
    db: Session, h: Hospital, *, patient: Patient, doctor_id: uuid.UUID, d: date, start_time: time,
    source: AppointmentSource, created_by: uuid.UUID | None = None, followup_id: uuid.UUID | None = None,
    status: S = S.booked, confirmed_via: str | None = None, enforce_window: bool = True,
) -> Appointment:
    if not h.is_active:
        raise InvalidInput("This hospital is not accepting bookings")
    doctor = scheduling.get_doctor(db, h, doctor_id)
    start, end = scheduling.resolve_slot(db, h, doctor, d, start_time, enforce_window=enforce_window)

    clash = db.scalar(select(Appointment.id).where(
        Appointment.patient_id == patient.id, Appointment.doctor_id == doctor.id,
        Appointment.scheduled_date == d, Appointment.status.in_(ACTIVE_APPOINTMENT_STATUSES),
    ))
    if clash:
        raise Conflict(f"{patient.full_name} already has an appointment with {doctor.name} on this date.", code="duplicate_booking")

    now = clock.now(h)
    appt = Appointment(
        hospital_id=h.id, patient_id=patient.id, doctor_id=doctor.id, followup_id=followup_id,
        reference=_new_reference(db), scheduled_date=d, start_time=start, end_time=end,
        starts_at=clock.local_to_utc(h, d, start), status=status, source=source, booked_at=now,
        created_by_user_id=created_by,
    )
    if status == S.confirmed:
        appt.confirmed_at, appt.confirmed_via = now, confirmed_via
    _claim_slot(db, appt, slot_key(doctor.id, d, start))
    appt.patient, appt.doctor = patient, doctor
    reminders.schedule_for_appointment(db, h, appt)
    audit.record(db, "appointment.booked", hospital_id=h.id, user_id=created_by, entity_type="appointment",
                 entity_id=appt.id, details={"reference": appt.reference, "source": source.value, "date": d.isoformat()})
    return appt


def change_status(
    db: Session, h: Hospital, appt: Appointment, new: S, *, user_id: uuid.UUID | None = None,
    via: str = "staff", reason: str | None = None,
) -> Appointment:
    old = appt.status
    if new == old:
        return appt
    if new not in TRANSITIONS[old]:
        raise InvalidInput(f"Cannot change an appointment from {old.value.replace('_', ' ')} to {new.value.replace('_', ' ')}")
    if new in (S.completed, S.no_show) and appt.scheduled_date > clock.today(h):
        raise InvalidInput("A visit can only be marked completed or no-show on or after the appointment date")

    now = clock.now(h)
    appt.status = new
    if new == S.confirmed:
        appt.confirmed_at, appt.confirmed_via = now, via
    elif new == S.cancelled:
        appt.cancelled_at, appt.cancel_reason, appt.slot_key = now, reason, None  # frees the slot
        reminders.cancel_for_appointment(db, appt.id, "Appointment cancelled")
    elif new == S.completed:
        appt.completed_at, appt.no_show_at = now, None
        reminders.cancel_for_appointment(db, appt.id, "Visit completed")
    elif new == S.no_show:
        appt.no_show_at, appt.completed_at = now, None
        reminders.cancel_for_appointment(db, appt.id, "Marked as no-show")
    elif new == S.reschedule_requested:
        reminders.cancel_for_appointment(db, appt.id, "Patient asked to reschedule")

    from app.services import followups  # follow-up outcomes depend on the visit outcome
    if new == S.completed:
        followups.on_visit_completed(db, h, appt, user_id=user_id)
    elif new == S.no_show:
        followups.on_visit_missed(db, h, appt)
    elif new == S.cancelled and appt.followup_id:
        followups.on_visit_cancelled(db, h, appt)

    db.flush()
    audit.record(db, "appointment.status_changed", hospital_id=h.id, user_id=user_id, entity_type="appointment",
                 entity_id=appt.id, details={"from": old.value, "to": new.value, "via": via, "reason": reason})
    return appt


def reschedule(
    db: Session, h: Hospital, appt: Appointment, *, d: date, start_time: time, doctor_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None, via: str = "staff", confirm: bool = False,
) -> Appointment:
    if appt.status not in ACTIVE_APPOINTMENT_STATUSES:
        raise InvalidInput("Only upcoming appointments can be rescheduled")
    doctor = scheduling.get_doctor(db, h, doctor_id or appt.doctor_id)
    start, end = scheduling.resolve_slot(db, h, doctor, d, start_time)
    new_key = slot_key(doctor.id, d, start)
    if new_key == appt.slot_key:
        raise InvalidInput("That is the current appointment time")

    old = {"date": appt.scheduled_date.isoformat(), "time": appt.start_time.strftime("%H:%M")}
    try:
        with db.begin_nested():  # release the old slot and claim the new one atomically
            appt.slot_key = None
            db.flush()
            appt.slot_key = new_key
            appt.doctor_id, appt.doctor = doctor.id, doctor
            appt.scheduled_date, appt.start_time, appt.end_time = d, start, end
            appt.starts_at = clock.local_to_utc(h, d, start)
            db.flush()
    except IntegrityError:
        db.refresh(appt)
        raise Conflict("Sorry, that slot was just booked. Please choose another time.", code="slot_taken")

    now = clock.now(h)
    appt.reschedule_count += 1
    if confirm:
        appt.status, appt.confirmed_at, appt.confirmed_via = S.confirmed, now, via
    else:
        appt.status, appt.confirmed_at, appt.confirmed_via = S.booked, None, None
    reminders.schedule_for_appointment(db, h, appt)

    if appt.followup_id:
        from app.services import followups
        followups.on_visit_rescheduled(db, h, appt)
    audit.record(db, "appointment.rescheduled", hospital_id=h.id, user_id=user_id, entity_type="appointment",
                 entity_id=appt.id, details={"from": old, "to": {"date": d.isoformat(), "time": start.strftime("%H:%M")}, "via": via})
    return appt
