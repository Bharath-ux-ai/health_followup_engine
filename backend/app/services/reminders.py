"""Reminder scheduling.

Rules
* Appointment reminder: the day before the visit at the hospital's reminder send time (local time).
* Follow-up reminders: 7 and 3 days before the follow-up date at the same send time.
* Idempotency key = kind + entity + target date. A key that was already sent is never sent again, even if the
  visit is moved away and back. Moving a visit cancels the old pending reminder and creates a new one.
* If a reminder's normal time has already passed when the visit/follow-up is saved, it is recorded as skipped;
  if *no* reminder would go out at all, one catch-up reminder is sent as soon as quiet hours allow.
"""
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Appointment, FollowUp, Hospital, ReminderSchedule
from app.models.enums import ACTIVE_APPOINTMENT_STATUSES, FollowUpStatus, ReminderKind, ReminderStatus
from app.services import clock

FOLLOWUP_OFFSETS = ((ReminderKind.followup_7d, 7), (ReminderKind.followup_3d, 3))
_FINAL = {ReminderStatus.sent, ReminderStatus.processing, ReminderStatus.failed}


def send_time(h: Hospital, d: date) -> datetime:
    return clock.local_to_utc(h, d, h.reminder_send_time)


def respect_quiet_hours(h: Hospital, when: datetime) -> datetime:
    s = get_settings()
    local = clock.to_local(h, when)
    if local.hour >= s.QUIET_HOURS_START:
        local = (local + timedelta(days=1)).replace(hour=s.QUIET_HOURS_END, minute=0, second=0, microsecond=0)
    elif local.hour < s.QUIET_HOURS_END:
        local = local.replace(hour=s.QUIET_HOURS_END, minute=0, second=0, microsecond=0)
    return local.astimezone(when.tzinfo)


def _upsert(
    db: Session, h: Hospital, *, key: str, kind: ReminderKind, patient_id: uuid.UUID, target: date, when: datetime,
    appointment_id: uuid.UUID | None = None, followup_id: uuid.UUID | None = None, skip_reason: str | None = None,
) -> ReminderSchedule:
    r = db.scalar(select(ReminderSchedule).where(ReminderSchedule.idempotency_key == key))
    if r is not None:
        if r.status in _FINAL:
            return r  # already sent / in flight / needs manual review — never duplicate
    else:
        r = ReminderSchedule(hospital_id=h.id, patient_id=patient_id, kind=kind, idempotency_key=key, target_date=target,
                             appointment_id=appointment_id, followup_id=followup_id)
        db.add(r)
    r.scheduled_for = when
    r.status = ReminderStatus.skipped if skip_reason else ReminderStatus.pending
    r.skip_reason, r.attempts, r.last_error = skip_reason, 0, None
    db.flush()
    return r


def _cancel(db: Session, where, reason: str, keep_keys: set[str] = frozenset()) -> None:
    stmt = update(ReminderSchedule).where(where, ReminderSchedule.status == ReminderStatus.pending)
    if keep_keys:
        stmt = stmt.where(ReminderSchedule.idempotency_key.not_in(keep_keys))
    db.execute(stmt.values(status=ReminderStatus.cancelled, skip_reason=reason).execution_options(synchronize_session="fetch"))


def cancel_for_appointment(db: Session, appointment_id: uuid.UUID, reason: str) -> None:
    _cancel(db, ReminderSchedule.appointment_id == appointment_id, reason)


def cancel_for_followup(db: Session, followup_id: uuid.UUID, reason: str) -> None:
    _cancel(db, ReminderSchedule.followup_id == followup_id, reason)


def cancel_for_patient(db: Session, patient_id: uuid.UUID, reason: str) -> None:
    _cancel(db, ReminderSchedule.patient_id == patient_id, reason)


def schedule_for_appointment(db: Session, h: Hospital, appt: Appointment) -> ReminderSchedule | None:
    key = f"{ReminderKind.appointment_1d.value}:{appt.id}:{appt.scheduled_date.isoformat()}"
    _cancel(db, ReminderSchedule.appointment_id == appt.id, "Appointment moved", keep_keys={key})
    if appt.status not in ACTIVE_APPOINTMENT_STATUSES:
        return None

    now, today = clock.now(h), clock.today(h)
    when = send_time(h, appt.scheduled_date - timedelta(days=1))
    skip = None
    if when < now:
        if appt.scheduled_date > today:
            when = respect_quiet_hours(h, now)  # booked after the usual send time: catch-up reminder
            if when >= appt.starts_at - timedelta(hours=1):
                skip = "Too close to the visit to send a reminder"
        else:
            skip = "Same-day booking — no day-before reminder needed"
    return _upsert(db, h, key=key, kind=ReminderKind.appointment_1d, patient_id=appt.patient_id,
                   target=appt.scheduled_date, when=when, appointment_id=appt.id, skip_reason=skip)


def schedule_for_followup(db: Session, h: Hospital, fu: FollowUp) -> list[ReminderSchedule]:
    plans = []
    for kind, days in FOLLOWUP_OFFSETS:
        key = f"{kind.value}:{fu.id}:{fu.due_date.isoformat()}"
        plans.append({"kind": kind, "days": days, "key": key, "when": send_time(h, fu.due_date - timedelta(days=days)), "skip": None})

    if fu.status != FollowUpStatus.scheduled:
        _cancel(db, ReminderSchedule.followup_id == fu.id, f"Follow-up {fu.status.value}")
        return []
    _cancel(db, ReminderSchedule.followup_id == fu.id, "Follow-up date changed", keep_keys={p["key"] for p in plans})

    now, today = clock.now(h), clock.today(h)
    for p in plans:
        if p["when"] < now:
            p["skip"] = f"Follow-up saved after the {p['days']}-day reminder time"
    if all(p["skip"] for p in plans) and fu.due_date > today:
        last = plans[-1]  # nothing would be sent: one catch-up reminder as soon as allowed
        last["when"], last["skip"] = respect_quiet_hours(h, now), None

    return [
        _upsert(db, h, key=p["key"], kind=p["kind"], patient_id=fu.patient_id, target=fu.due_date, when=p["when"],
                followup_id=fu.id, skip_reason=p["skip"])
        for p in plans
    ]
