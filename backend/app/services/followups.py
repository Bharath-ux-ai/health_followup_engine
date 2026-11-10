"""Follow-up lifecycle.

Status meanings (deliberately distinct):
  scheduled   — date set, reminders pending or sent, no patient decision yet
  confirmed   — patient confirmed; a visit is booked on the follow-up date
  rescheduled — patient chose a different date; a visit is booked on that date
  completed   — the return visit was recorded (this is what "brought back" counts)
  missed      — overdue: the date passed with no recorded visit
  cancelled   — no longer needed
"Unconfirmed" is not a status: it is a flag on scheduled follow-ups whose reminders went out without any response
as the date gets close. Not tapping a button never makes a patient "missed".
"""
import uuid
from datetime import date, time, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Appointment, FollowUp, FollowUpContact, Hospital, ReminderSchedule
from app.models.enums import (
    ACTIVE_APPOINTMENT_STATUSES, OPEN_FOLLOWUP_STATUSES, AppointmentSource, AppointmentStatus, FollowUpStatus as F,
    ReminderStatus,
)
from app.services import audit, clock, reminders, scheduling
from app.services.errors import Conflict, InvalidInput

CONTACT_OUTCOMES = {"reached", "no_answer", "wrong_number", "will_visit", "declined"}
AUTO_LINK_WINDOW = (7, 30)  # a completed visit with the same doctor this many days before/after the due date counts


def create(db: Session, h: Hospital, appt: Appointment, due: date, *, user_id: uuid.UUID | None = None) -> FollowUp:
    today = clock.today(h)
    if appt.status == AppointmentStatus.cancelled:
        raise InvalidInput("Cannot schedule a follow-up for a cancelled appointment")
    if due <= today or due <= appt.scheduled_date:
        raise InvalidInput("The follow-up date must be after today and after the visit date")
    if due > today + timedelta(days=365):
        raise InvalidInput("The follow-up date must be within one year")
    fu = FollowUp(hospital_id=h.id, patient_id=appt.patient_id, source_appointment_id=appt.id, doctor_id=appt.doctor_id,
                  due_date=due, original_due_date=due, status=F.scheduled, created_by_user_id=user_id)
    try:
        with db.begin_nested():
            db.add(fu)
            db.flush()
    except IntegrityError:
        raise Conflict("This visit already has a follow-up. Open it to change the date.", code="followup_exists")
    reminders.schedule_for_followup(db, h, fu)
    audit.record(db, "followup.created", hospital_id=h.id, user_id=user_id, entity_type="followup", entity_id=fu.id,
                 details={"due_date": due.isoformat(), "appointment": appt.reference})
    return fu


def change_date(db: Session, h: Hospital, fu: FollowUp, due: date, *, user_id: uuid.UUID | None = None) -> FollowUp:
    if fu.status not in (F.scheduled, F.missed):
        raise InvalidInput("This follow-up already has a booked visit — reschedule that appointment instead")
    if due <= clock.today(h):
        raise InvalidInput("The follow-up date must be after today")
    old = fu.due_date
    fu.due_date, fu.status, fu.missed_at = due, F.scheduled, None
    reminders.schedule_for_followup(db, h, fu)
    audit.record(db, "followup.date_changed", hospital_id=h.id, user_id=user_id, entity_type="followup", entity_id=fu.id,
                 details={"from": old.isoformat(), "to": due.isoformat()})
    return fu


def booked_visit(db: Session, fu: FollowUp) -> Appointment | None:
    return db.scalar(select(Appointment).where(Appointment.followup_id == fu.id)
                     .order_by(Appointment.created_at.desc()).limit(1))


def book_visit(
    db: Session, h: Hospital, fu: FollowUp, d: date, start: time, *, via: str, user_id: uuid.UUID | None = None,
) -> Appointment:
    """Book the return visit for a follow-up (patient tapped Confirm, chose a new time, or staff booked by phone)."""
    from app.services import appointments
    if fu.status not in OPEN_FOLLOWUP_STATUSES | {F.missed}:
        raise InvalidInput("This follow-up is closed")
    moved = d != fu.due_date
    existing = booked_visit(db, fu)
    if existing and existing.status in ACTIVE_APPOINTMENT_STATUSES:
        appt = appointments.reschedule(db, h, existing, d=d, start_time=start, user_id=user_id, via=via, confirm=True)
        _mark_booked(db, h, fu, d, moved)
        return appt
    appt = appointments.book(db, h, patient=fu.patient, doctor_id=fu.doctor_id, d=d, start_time=start,
                             source=AppointmentSource.followup, followup_id=fu.id, created_by=user_id,
                             status=AppointmentStatus.confirmed, confirmed_via=via, enforce_window=False)
    _mark_booked(db, h, fu, d, moved)
    return appt


def _mark_booked(db: Session, h: Hospital, fu: FollowUp, d: date, moved: bool) -> None:
    now = clock.now(h)
    if not moved:
        fu.status, fu.confirmed_at = F.confirmed, now
    else:
        fu.status, fu.rescheduled_at, fu.due_date = F.rescheduled, now, d
    fu.missed_at = None
    reminders.schedule_for_followup(db, h, fu)  # cancels remaining follow-up reminders; the visit reminder takes over


def pick_slot(db: Session, h: Hospital, fu: FollowUp) -> time | None:
    """Prefer the time of the original visit, else the earliest free slot that day with the same doctor."""
    doctor = scheduling.get_doctor(db, h, fu.doctor_id)
    free = [s for s in scheduling.available_slots(db, h, doctor, fu.due_date, enforce_window=False) if s["available"]]
    preferred = fu.source_appointment.start_time.strftime("%H:%M") if fu.source_appointment else None
    chosen = next((s for s in free if s["start_time"] == preferred), free[0] if free else None)
    return time.fromisoformat(chosen["start_time"]) if chosen else None


def set_status(db: Session, h: Hospital, fu: FollowUp, new: F, *, user_id: uuid.UUID | None = None) -> FollowUp:
    allowed = {
        F.scheduled: {F.completed, F.cancelled},
        F.confirmed: {F.completed, F.cancelled},
        F.rescheduled: {F.completed, F.cancelled},
        F.missed: {F.completed, F.cancelled},
        F.completed: set(),
        F.cancelled: set(),
    }
    if new == fu.status:
        return fu
    if new not in allowed[fu.status]:
        raise InvalidInput(f"Cannot change a {fu.status.value} follow-up to {new.value}")
    if new == F.completed and fu.due_date - timedelta(days=AUTO_LINK_WINDOW[0]) > clock.today(h):
        raise InvalidInput("A follow-up can only be marked completed when the patient has returned")
    now = clock.now(h)
    old = fu.status
    fu.status = new
    if new == F.completed:
        fu.completed_at = now
    elif new == F.cancelled:
        fu.cancelled_at = now
        visit = booked_visit(db, fu)
        if visit and visit.status in ACTIVE_APPOINTMENT_STATUSES:
            from app.services import appointments
            appointments.change_status(db, h, visit, AppointmentStatus.cancelled, user_id=user_id, reason="Follow-up cancelled")
    reminders.cancel_for_followup(db, fu.id, f"Follow-up {new.value}")
    audit.record(db, "followup.status_changed", hospital_id=h.id, user_id=user_id, entity_type="followup",
                 entity_id=fu.id, details={"from": old.value, "to": new.value})
    return fu


def log_contact(db: Session, h: Hospital, fu: FollowUp, outcome: str, note: str | None, *, user_id: uuid.UUID | None) -> FollowUpContact:
    if outcome not in CONTACT_OUTCOMES:
        raise InvalidInput("Unknown contact outcome")
    now = clock.now(h)
    c = FollowUpContact(hospital_id=h.id, followup_id=fu.id, user_id=user_id, outcome=outcome,
                        note=(note or "").strip()[:240] or None, contacted_at=now)
    db.add(c)
    fu.last_contacted_at, fu.contact_count = now, fu.contact_count + 1
    audit.record(db, "followup.contacted", hospital_id=h.id, user_id=user_id, entity_type="followup", entity_id=fu.id,
                 details={"outcome": outcome})
    return c


# ---- derived state -------------------------------------------------------------
def attention(db: Session, h: Hospital, fu: FollowUp, reminder_rows: list[ReminderSchedule] | None = None) -> str | None:
    """Return 'overdue', 'unconfirmed' or None. Both are shown in red."""
    today = clock.today(h)
    if fu.status == F.missed or (fu.status in OPEN_FOLLOWUP_STATUSES and fu.due_date < today):
        return "overdue"
    if fu.status == F.scheduled:
        rows = reminder_rows if reminder_rows is not None else list(db.scalars(
            select(ReminderSchedule).where(ReminderSchedule.followup_id == fu.id)))
        relevant = [r for r in rows if r.target_date == fu.due_date]
        reminded = any(r.status == ReminderStatus.sent for r in relevant)
        responded = any(r.response for r in relevant)
        if not responded and (reminded or not relevant) and (fu.due_date - today).days <= get_settings().FOLLOWUP_RED_DAYS:
            return "unconfirmed"
    return None


# ---- hooks from appointment outcomes ----------------------------------------------
def on_visit_completed(db: Session, h: Hospital, appt: Appointment, *, user_id=None) -> None:
    now = clock.now(h)
    targets: list[FollowUp] = []
    if appt.followup_id:
        fu = db.get(FollowUp, appt.followup_id)
        if fu:
            targets.append(fu)
    # A patient who comes back to the same doctor around the follow-up date — even via a fresh booking — has returned.
    before, after = AUTO_LINK_WINDOW
    targets += db.scalars(select(FollowUp).where(
        FollowUp.patient_id == appt.patient_id, FollowUp.doctor_id == appt.doctor_id,
        FollowUp.status.in_(OPEN_FOLLOWUP_STATUSES | {F.missed}), FollowUp.source_appointment_id != appt.id,
        FollowUp.due_date >= appt.scheduled_date - timedelta(days=after),
        FollowUp.due_date <= appt.scheduled_date + timedelta(days=before),
    )).all()
    for fu in {f.id: f for f in targets}.values():
        if fu.status in (F.completed, F.cancelled):
            continue
        fu.status, fu.completed_at, fu.missed_at = F.completed, now, None
        reminders.cancel_for_followup(db, fu.id, "Patient returned")
        audit.record(db, "followup.completed", hospital_id=h.id, user_id=user_id, entity_type="followup", entity_id=fu.id,
                     details={"appointment": appt.reference})


def on_visit_missed(db: Session, h: Hospital, appt: Appointment) -> None:
    if appt.followup_id:
        fu = db.get(FollowUp, appt.followup_id)
        if fu and fu.status in OPEN_FOLLOWUP_STATUSES:
            fu.status, fu.missed_at = F.missed, clock.now(h)


def on_visit_cancelled(db: Session, h: Hospital, appt: Appointment) -> None:
    fu = db.get(FollowUp, appt.followup_id) if appt.followup_id else None
    if fu and fu.status in (F.confirmed, F.rescheduled):  # back to awaiting a decision; staff can rebook
        fu.status = F.scheduled
        reminders.schedule_for_followup(db, h, fu)


def on_visit_rescheduled(db: Session, h: Hospital, appt: Appointment) -> None:
    fu = db.get(FollowUp, appt.followup_id) if appt.followup_id else None
    if fu and fu.status in OPEN_FOLLOWUP_STATUSES and fu.due_date != appt.scheduled_date:
        fu.status, fu.due_date, fu.rescheduled_at = F.rescheduled, appt.scheduled_date, clock.now(h)


def mark_overdue(db: Session, h: Hospital) -> int:
    """Follow-ups whose date has passed with no recorded visit become 'missed' (overdue)."""
    today = clock.today(h)
    rows = db.scalars(select(FollowUp).where(
        FollowUp.hospital_id == h.id, FollowUp.status.in_(OPEN_FOLLOWUP_STATUSES), FollowUp.due_date < today)).all()
    now = clock.now(h)
    for fu in rows:
        fu.status, fu.missed_at = F.missed, now
        reminders.cancel_for_followup(db, fu.id, "Follow-up date passed")
    return len(rows)
