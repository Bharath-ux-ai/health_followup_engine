"""Patient responses: WhatsApp webhooks (real), simulator taps (demo) and reschedule links.

Real webhooks and the simulator converge on apply_patient_action(), so the demo exercises the exact same logic
that live WhatsApp replies do.
"""
import hashlib
import hmac
import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decrypt_secret
from app.models import (
    Appointment, FollowUp, Hospital, MessageDeliveryLog, Patient, ReminderSchedule, WhatsAppConfig, WhatsAppMessage,
)
from app.models.enums import (
    ACTIVE_APPOINTMENT_STATUSES, OPEN_FOLLOWUP_STATUSES, AppointmentStatus, FollowUpStatus, MessageDirection,
    MessageStatus, ReminderKind, ReminderResponse, ReminderStatus, TemplatePurpose as P,
)
from app.services import appointments, audit, clock, followups, patients
from app.services.errors import InvalidInput, NotFound
from app.services.phone import digits
from app.services.whatsapp import outbound
from app.services.whatsapp.templates import fmt_date, fmt_time

STOP_WORDS = {"STOP", "UNSUBSCRIBE", "நிறுத்து"}
_STATUS_RANK = {MessageStatus.sent: 1, MessageStatus.delivered: 2, MessageStatus.read: 3}


# ---- signature validation ---------------------------------------------------------
def signature_valid(raw_body: bytes, header: str | None, secret: str | None) -> bool:
    if not header or not secret or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.removeprefix("sha256="))


def candidate_secrets(db: Session, payload: dict) -> list[str]:
    secrets_ = [get_settings().META_APP_SECRET] if get_settings().META_APP_SECRET else []
    for pid in _phone_number_ids(payload):
        cfg = db.scalar(select(WhatsAppConfig).where(WhatsAppConfig.phone_number_id == pid))
        own = decrypt_secret(cfg.app_secret_enc) if cfg else None
        if own:
            secrets_.append(own)
    return secrets_


def _phone_number_ids(payload: dict) -> set[str]:
    return {
        (c.get("value") or {}).get("metadata", {}).get("phone_number_id")
        for e in payload.get("entry", []) for c in e.get("changes", [])
    } - {None}


# ---- webhook processing ------------------------------------------------------------
def process_webhook(db: Session, payload: dict) -> dict:
    summary = {"statuses": 0, "messages": 0, "ignored": 0}
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value") or {}
            pid = (value.get("metadata") or {}).get("phone_number_id")
            cfg = db.scalar(select(WhatsAppConfig).where(WhatsAppConfig.phone_number_id == pid)) if pid else None
            if cfg is None:
                summary["ignored"] += 1
                continue
            h = db.get(Hospital, cfg.hospital_id)
            for st in value.get("statuses", []):
                summary["statuses"] += _apply_status(db, h, st)
            for msg in value.get("messages", []):
                summary["messages"] += _apply_inbound(db, h, msg)
    db.commit()
    return summary


def _ts(value) -> datetime:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError):
        return clock.real_now()


def _apply_status(db: Session, h: Hospital, st: dict) -> int:
    msg = db.scalar(select(WhatsAppMessage).where(WhatsAppMessage.wamid == st.get("id")))
    if msg is None or msg.hospital_id != h.id:
        return 0
    try:
        new = MessageStatus(st.get("status"))
    except ValueError:
        return 0
    at = _ts(st.get("timestamp"))
    err = (st.get("errors") or [{}])[0]
    detail = f"[{err.get('code')}] {(err.get('error_data') or {}).get('details') or err.get('title') or ''}" if new == MessageStatus.failed else None
    msg.delivery_logs.append(MessageDeliveryLog(status=new.value, detail=detail, raw=st, occurred_at=at))
    if new == MessageStatus.failed:
        msg.status, msg.failed_at = MessageStatus.failed, at
        msg.error_code, msg.error_message = str(err.get("code")), (detail or "")[:400]
        r = db.get(ReminderSchedule, msg.reminder_id) if msg.reminder_id else None
        if r and r.message_id == msg.id:
            r.status, r.last_error = ReminderStatus.failed, f"Delivery failed: {detail}"[:400]
    elif _STATUS_RANK.get(new, 0) > _STATUS_RANK.get(msg.status, 0) and msg.status != MessageStatus.failed:
        msg.status = new  # webhooks can arrive out of order: never downgrade
        if new == MessageStatus.delivered:
            msg.delivered_at = at
        elif new == MessageStatus.read:
            msg.read_at, msg.delivered_at = at, msg.delivered_at or at
    return 1


def _apply_inbound(db: Session, h: Hospital, m: dict) -> int:
    wamid = m.get("id")
    if wamid and db.scalar(select(WhatsAppMessage.id).where(WhatsAppMessage.wamid == wamid)):
        return 0  # Meta retries webhooks; process each inbound message once
    sender = digits(m.get("from", ""))
    payload = text = None
    if m.get("type") == "button":
        payload, text = (m.get("button") or {}).get("payload"), (m.get("button") or {}).get("text")
    elif m.get("type") == "interactive":
        reply = (m.get("interactive") or {}).get("button_reply") or {}
        payload, text = reply.get("id"), reply.get("title")
    elif m.get("type") == "text":
        text = (m.get("text") or {}).get("body", "")

    reminder, action = _resolve_action(db, h, payload, text, (m.get("context") or {}).get("id"))
    patient = db.get(Patient, reminder.patient_id) if reminder else None
    if patient is None or digits(patient.phone) != sender:
        reminder, action = None, None  # never act on a payload that does not belong to the sender
        patient = db.scalar(select(Patient).where(Patient.hospital_id == h.id, Patient.deleted_at.is_(None))
                            .where(Patient.phone == "+" + sender).limit(1))

    _record_inbound(db, h, patient, "+" + sender, text or payload or f"[{m.get('type')}]", wamid,
                    kind="button" if payload else "text", reminder=reminder, at=_ts(m.get("timestamp")))
    if reminder and action:
        apply_patient_action(db, h, reminder, action)
    elif patient and text and text.strip().upper() in STOP_WORDS:
        patients.set_consent(db, h, patient, False, "whatsapp_stop")
        audit.record(db, "patient.consent_withdrawn", hospital_id=h.id, entity_type="patient", entity_id=patient.id)
    return 1


def _resolve_action(db: Session, h: Hospital, payload: str | None, text: str | None, context_wamid: str | None):
    reminder = action = None
    if payload and payload.startswith("TT1|"):
        try:
            _, action, rid = payload.split("|", 2)
            reminder = db.get(ReminderSchedule, uuid.UUID(rid))
        except (ValueError, TypeError):
            reminder = None
    if reminder is None and context_wamid:  # fall back to the message the patient replied to
        original = db.scalar(select(WhatsAppMessage).where(WhatsAppMessage.wamid == context_wamid))
        if original and original.reminder_id:
            reminder = db.get(ReminderSchedule, original.reminder_id)
            labels = {b["label"].lower(): b["action"] for b in (original.buttons or [])}
            action = labels.get((text or "").strip().lower())
    if reminder is None or reminder.hospital_id != h.id or action not in ("CONFIRM", "RESCHEDULE"):
        return None, None
    return reminder, action


def _record_inbound(db: Session, h: Hospital, patient: Patient | None, phone: str, body: str, wamid: str | None, *,
                    kind: str, reminder: ReminderSchedule | None, simulated: bool = False, at: datetime | None = None) -> WhatsAppMessage:
    msg = WhatsAppMessage(
        hospital_id=h.id, patient_id=patient.id if patient else None, reminder_id=reminder.id if reminder else None,
        appointment_id=reminder.appointment_id if reminder else None, followup_id=reminder.followup_id if reminder else None,
        direction=MessageDirection.inbound, kind=kind, purpose="patient_reply", phone=phone, body=body[:1000],
        wamid=wamid, status=MessageStatus.received if not simulated else MessageStatus.simulated, is_simulated=simulated,
        occurred_at=clock.now(h) if simulated or at is None else max(at, clock.now(h)),
    )
    db.add(msg)
    db.flush()
    return msg


# ---- simulator ---------------------------------------------------------------------
def simulate_tap(db: Session, h: Hospital, message: WhatsAppMessage, action: str) -> dict:
    """Demo: the presenter taps Confirm/Reschedule on a simulated reminder. Only allowed for simulated messages."""
    if not message.is_simulated or message.direction != MessageDirection.outbound or not message.reminder_id:
        raise InvalidInput("Only simulated reminder messages can be answered from the simulator")
    if action not in ("CONFIRM", "RESCHEDULE"):
        raise InvalidInput("Unknown action")
    reminder = db.get(ReminderSchedule, message.reminder_id)
    patient = db.get(Patient, reminder.patient_id)
    label = next((b["label"] for b in (message.buttons or []) if b["action"] == action), action.title())
    _record_inbound(db, h, patient, patient.phone, label, None, kind="button", reminder=reminder, simulated=True)
    return apply_patient_action(db, h, reminder, action)


# ---- core action handling ---------------------------------------------------------------
def apply_patient_action(db: Session, h: Hospital, reminder: ReminderSchedule, action: str) -> dict:
    response = ReminderResponse.confirmed if action == "CONFIRM" else ReminderResponse.reschedule_requested
    if reminder.response == response:
        return {"result": "already_recorded"}  # duplicate tap: no second reply
    patient = db.get(Patient, reminder.patient_id)
    now = clock.now(h)
    reminder.response, reminder.responded_at = response, now
    ids = {"reminder_id": reminder.id}

    if reminder.kind == ReminderKind.appointment_1d:
        appt = db.get(Appointment, reminder.appointment_id)
        ids["appointment_id"] = appt.id
        if appt.status not in ACTIVE_APPOINTMENT_STATUSES or appt.scheduled_date != reminder.target_date:
            return {"result": "appointment_no_longer_active"}
        details = {"doctor": appt.doctor.name, "date": fmt_date(appt.scheduled_date, patient.preferred_language),
                   "time": fmt_time(appt.start_time), "reference": appt.reference}
        if action == "CONFIRM":
            appointments.change_status(db, h, appt, AppointmentStatus.confirmed, via="whatsapp")
            outbound.send_reply(db, h, patient, P.appointment_confirmed_reply, details, **ids)
            return {"result": "appointment_confirmed", "appointment_id": str(appt.id)}
        appointments.change_status(db, h, appt, AppointmentStatus.reschedule_requested, via="whatsapp")
        link = outbound.action_link("appt", appt.id)
        outbound.send_reply(db, h, patient, P.appointment_reschedule_reply, {**details, "link": link},
                            meta={"action_url": link, "action": "reschedule_appointment"}, **ids)
        return {"result": "reschedule_requested", "appointment_id": str(appt.id), "action_url": link}

    fu = db.get(FollowUp, reminder.followup_id)
    ids["followup_id"] = fu.id
    if fu.status not in OPEN_FOLLOWUP_STATUSES or fu.due_date != reminder.target_date:
        return {"result": "followup_no_longer_open"}
    link = outbound.action_link("fu", fu.id)
    if action == "CONFIRM":
        appt = followups.booked_visit(db, fu) if fu.status != FollowUpStatus.scheduled else None
        if appt is None or appt.status not in ACTIVE_APPOINTMENT_STATUSES:
            slot = followups.pick_slot(db, h, fu)
            appt = followups.book_visit(db, h, fu, fu.due_date, slot, via="whatsapp") if slot else None
        if appt:
            appt_link = outbound.action_link("appt", appt.id)
            outbound.send_reply(db, h, patient, P.followup_booked_reply, {
                "doctor": appt.doctor.name, "date": fmt_date(appt.scheduled_date, patient.preferred_language),
                "time": fmt_time(appt.start_time), "reference": appt.reference, "link": appt_link,
            }, meta={"action_url": appt_link, "action": "reschedule_appointment"}, **ids, appointment_id=appt.id)
            return {"result": "followup_booked", "appointment_id": str(appt.id)}
        outbound.send_reply(db, h, patient, P.followup_reschedule_reply, {"link": link},
                            meta={"action_url": link, "action": "book_followup"}, **ids)
        return {"result": "followup_confirmed_no_slot", "action_url": link}
    outbound.send_reply(db, h, patient, P.followup_reschedule_reply, {"link": link},
                        meta={"action_url": link, "action": "book_followup"}, **ids)
    return {"result": "followup_reschedule_requested", "action_url": link}


# ---- reschedule links (public) --------------------------------------------------------------
def load_action(db: Session, kind: str, entity_id: uuid.UUID) -> tuple[Hospital, Appointment | None, FollowUp | None]:
    if kind == "appt":
        appt = db.get(Appointment, entity_id)
        if not appt or appt.status not in ACTIVE_APPOINTMENT_STATUSES:
            raise NotFound("This link is no longer active. Please contact the hospital.")
        return db.get(Hospital, appt.hospital_id), appt, None
    if kind == "fu":
        fu = db.get(FollowUp, entity_id)
        if not fu or fu.status not in OPEN_FOLLOWUP_STATUSES | {FollowUpStatus.missed}:
            raise NotFound("This link is no longer active. Please contact the hospital.")
        return db.get(Hospital, fu.hospital_id), None, fu
    raise NotFound("Invalid link")


def reschedule_via_link(db: Session, kind: str, entity_id: uuid.UUID, d: date, start: time) -> Appointment:
    h, appt, fu = load_action(db, kind, entity_id)
    if appt is not None:
        appt = appointments.reschedule(db, h, appt, d=d, start_time=start, via="patient_link", confirm=True)
    else:
        appt = followups.book_visit(db, h, fu, d, start, via="patient_link")
    patient = db.get(Patient, appt.patient_id)
    outbound.send_reply(db, h, patient, P.rescheduled_reply, {
        "doctor": appt.doctor.name, "date": fmt_date(appt.scheduled_date, patient.preferred_language),
        "time": fmt_time(appt.start_time), "reference": appt.reference,
    }, appointment_id=appt.id, followup_id=appt.followup_id)
    return appt
