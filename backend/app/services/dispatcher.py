"""Background reminder dispatch.

Safety properties
* Claiming: a reminder moves pending -> processing with a conditional UPDATE, so two workers can never send the same
  reminder (plus FOR UPDATE SKIP LOCKED on PostgreSQL).
* Re-validation: right before sending, the appointment/follow-up and patient consent are re-checked.
* Never resend: if a successful message already exists for a reminder it is marked sent, not sent again.
* Retries: transient errors are retried with backoff up to REMINDER_MAX_ATTEMPTS; timeouts where delivery is unknown
  are NOT retried automatically (flagged delivery_uncertain for a human to check).
* Crash recovery: reminders stuck in 'processing' are failed with delivery_uncertain rather than resent blindly.
"""
import logging
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Appointment, FollowUp, Hospital, Patient, ReminderSchedule, WhatsAppMessage
from app.models.enums import (
    AppointmentStatus, FollowUpStatus, MessageDirection, MessageStatus, ReminderKind, ReminderStatus,
)
from app.services import clock, followups
from app.services.whatsapp import outbound

log = logging.getLogger("tectha.dispatcher")
BACKOFF_MINUTES = [5, 15, 45]
STALE_AFTER = timedelta(minutes=10)
_SUCCESS = (MessageStatus.sent, MessageStatus.delivered, MessageStatus.read, MessageStatus.simulated)


def run_cycle(db: Session, hospital: Hospital | None = None) -> dict:
    """Process due reminders and overdue follow-ups for one or all active hospitals."""
    hospitals = [hospital] if hospital else list(db.scalars(select(Hospital).where(Hospital.is_active.is_(True), Hospital.deleted_at.is_(None))))
    totals = {"sent": 0, "simulated": 0, "failed": 0, "retry": 0, "skipped": 0, "overdue": 0}
    for h in hospitals:
        _recover_stale(db, h)
        totals["overdue"] += followups.mark_overdue(db, h)  # close overdue follow-ups first: no late reminders
        db.commit()
        for k, v in process_due(db, h).items():
            totals[k] += v
        db.commit()
    return totals


def _recover_stale(db: Session, h: Hospital) -> None:
    cutoff = clock.real_now() - STALE_AFTER
    db.execute(update(ReminderSchedule).where(
        ReminderSchedule.hospital_id == h.id, ReminderSchedule.status == ReminderStatus.processing,
        ReminderSchedule.locked_at < cutoff,
    ).values(status=ReminderStatus.failed, delivery_uncertain=True,
             last_error="Worker stopped while sending — check WhatsApp before retrying"))
    db.commit()


def process_due(db: Session, h: Hospital) -> dict:
    counts = {"sent": 0, "simulated": 0, "failed": 0, "retry": 0, "skipped": 0}
    now = clock.now(h)
    q = (select(ReminderSchedule.id).where(
        ReminderSchedule.hospital_id == h.id, ReminderSchedule.status == ReminderStatus.pending,
        ReminderSchedule.scheduled_for <= now,
    ).order_by(ReminderSchedule.scheduled_for).limit(get_settings().REMINDER_BATCH_SIZE))
    if db.bind.dialect.name == "postgresql":
        q = q.with_for_update(skip_locked=True)
    ids = list(db.scalars(q))
    for rid in ids:
        claimed = db.execute(update(ReminderSchedule).where(
            ReminderSchedule.id == rid, ReminderSchedule.status == ReminderStatus.pending,
        ).values(status=ReminderStatus.processing, locked_at=clock.real_now()))
        db.commit()
        if claimed.rowcount != 1:
            continue  # another worker took it
        outcome = _process_one(db, h, db.get(ReminderSchedule, rid))
        counts[outcome] += 1
        db.commit()
    return counts


def _invalid_reason(db: Session, h: Hospital, r: ReminderSchedule, patient: Patient | None) -> str | None:
    if patient is None or patient.deleted_at:
        return "Patient record removed"
    if r.target_date < clock.today(h):
        return "Date already passed"
    if r.kind == ReminderKind.appointment_1d:
        appt = db.get(Appointment, r.appointment_id)
        if appt is None or appt.scheduled_date != r.target_date:
            return "Appointment moved"
        if appt.status not in (AppointmentStatus.booked, AppointmentStatus.confirmed):
            return f"Appointment is {appt.status.value.replace('_', ' ')}"
        if appt.starts_at <= clock.now(h):
            return "Visit time already passed"
    else:
        fu = db.get(FollowUp, r.followup_id)
        if fu is None or fu.due_date != r.target_date:
            return "Follow-up date changed"
        if fu.status != FollowUpStatus.scheduled:
            return f"Follow-up is {fu.status.value}"
    return None


def _process_one(db: Session, h: Hospital, r: ReminderSchedule) -> str:
    patient = db.get(Patient, r.patient_id)
    reason = _invalid_reason(db, h, r, patient)
    if reason:
        r.status, r.skip_reason, r.locked_at = ReminderStatus.cancelled, reason, None
        return "skipped"
    if not patient.whatsapp_consent:
        r.status, r.skip_reason, r.locked_at = ReminderStatus.skipped, "No WhatsApp consent recorded", None
        return "skipped"

    prior = db.scalar(select(WhatsAppMessage).where(
        WhatsAppMessage.reminder_id == r.id, WhatsAppMessage.direction == MessageDirection.outbound,
        WhatsAppMessage.kind == "template", WhatsAppMessage.status.in_(_SUCCESS)))
    if prior is not None:  # already went out (e.g. crash after send) — never send twice
        r.status, r.message_id, r.sent_at, r.locked_at = ReminderStatus.sent, prior.id, prior.occurred_at, None
        return "simulated" if prior.is_simulated else "sent"

    result, msg = outbound.send_reminder(db, h, r, patient)
    r.message_id, r.locked_at = msg.id, None
    if result.ok:
        r.status, r.sent_at, r.last_error = ReminderStatus.sent, clock.now(h), None
        return "simulated" if result.simulated else "sent"

    r.attempts += 1
    r.last_error = f"[{result.error_code}] {result.error_message}"[:400]
    if result.uncertain:
        r.status, r.delivery_uncertain = ReminderStatus.failed, True
        return "failed"
    if result.retryable and r.attempts < get_settings().REMINDER_MAX_ATTEMPTS:
        delay = BACKOFF_MINUTES[min(r.attempts - 1, len(BACKOFF_MINUTES) - 1)]
        r.status, r.scheduled_for = ReminderStatus.pending, clock.now(h) + timedelta(minutes=delay)
        log.warning("reminder %s failed (%s), retrying in %s min", r.id, result.error_code, delay)
        return "retry"
    r.status = ReminderStatus.failed
    log.error("reminder %s failed permanently: %s", r.id, r.last_error)
    return "failed"


def retry(db: Session, h: Hospital, r: ReminderSchedule, *, confirm_uncertain: bool = False) -> ReminderSchedule:
    """Staff-initiated retry of a failed reminder."""
    from app.services.errors import InvalidInput
    if r.status != ReminderStatus.failed:
        raise InvalidInput("Only failed reminders can be retried")
    if r.delivery_uncertain and not confirm_uncertain:
        raise InvalidInput("Delivery of this reminder is uncertain. Confirm the patient did not receive it before retrying.", code="uncertain")
    delivered = db.scalar(select(WhatsAppMessage.id).where(
        WhatsAppMessage.reminder_id == r.id, WhatsAppMessage.kind == "template",
        WhatsAppMessage.status.in_((MessageStatus.delivered, MessageStatus.read))))
    if delivered:
        raise InvalidInput("WhatsApp reports this reminder as delivered — not resending")
    r.status, r.scheduled_for, r.attempts, r.delivery_uncertain, r.locked_at = ReminderStatus.pending, clock.now(h), 0, False, None
    return r
