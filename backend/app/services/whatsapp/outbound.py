"""Building and recording outbound WhatsApp messages (reminders, replies, test messages)."""
from datetime import timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_action_token, decrypt_secret
from app.models import Appointment, FollowUp, Hospital, MessageDeliveryLog, Patient, ReminderSchedule, WhatsAppConfig, WhatsAppMessage
from app.models.enums import MessageDirection, MessageStatus, ReminderKind, TemplatePurpose as P, WhatsAppMode
from app.services import clock
from app.services.phone import digits
from app.services.whatsapp import templates as tpl
from app.services.whatsapp.provider import CloudApiProvider, SendResult, SimulationProvider

# Tests inject an httpx.MockTransport here to exercise the real Cloud API adapter without network access.
transport_override: httpx.BaseTransport | None = None


def get_config(db: Session, h: Hospital) -> WhatsAppConfig:
    cfg = db.scalar(select(WhatsAppConfig).where(WhatsAppConfig.hospital_id == h.id))
    if cfg is None:
        cfg = WhatsAppConfig(hospital_id=h.id, mode=WhatsAppMode.simulation)
        db.add(cfg)
        db.flush()
    return cfg


class NotConfigured(Exception):
    pass


def provider_for(db: Session, h: Hospital, patient: Patient | None):
    cfg = get_config(db, h)
    if (patient is not None and patient.is_demo) or cfg.mode == WhatsAppMode.simulation:
        return SimulationProvider()  # fictional patients are never messaged for real
    token = decrypt_secret(cfg.access_token_enc)
    if not cfg.phone_number_id or not token:
        raise NotConfigured("WhatsApp live mode is on but the phone number ID or access token is missing")
    return CloudApiProvider(cfg.phone_number_id, token, transport=transport_override)


def action_link(kind: str, entity_id) -> str:
    token = create_action_token(kind, entity_id, clock.real_now() + timedelta(days=45))
    return f"{get_settings().PUBLIC_APP_URL.rstrip('/')}/r/{token}"


def _record(
    db: Session, h: Hospital, *, patient: Patient | None, phone: str, result: SendResult, kind: str, purpose: str,
    language: str | None, body: str, buttons: list | None = None, meta: dict | None = None, reminder_id=None,
    appointment_id=None, followup_id=None,
) -> WhatsAppMessage:
    now = clock.now(h)
    if result.simulated:
        status, detail = MessageStatus.simulated, "Simulation mode — shown in the in-app simulator, not sent via WhatsApp"
    elif result.ok:
        status, detail = MessageStatus.sent, "Accepted by WhatsApp Cloud API"
    else:
        status, detail = MessageStatus.failed, f"[{result.error_code}] {result.error_message}"
    msg = WhatsAppMessage(
        hospital_id=h.id, patient_id=patient.id if patient else None, reminder_id=reminder_id,
        appointment_id=appointment_id, followup_id=followup_id, direction=MessageDirection.outbound, kind=kind,
        purpose=purpose, language=language, phone=phone, body=body, buttons=buttons, meta=meta, wamid=result.wamid,
        status=status, is_simulated=result.simulated, error_code=result.error_code,
        error_message=result.error_message, occurred_at=now, failed_at=now if status == MessageStatus.failed else None,
    )
    msg.delivery_logs.append(MessageDeliveryLog(status=status.value, detail=detail[:400], raw=result.raw or None, occurred_at=now))
    db.add(msg)
    db.flush()
    return msg


def _send(db: Session, h: Hospital, patient: Patient | None, fn) -> SendResult:
    try:
        provider = provider_for(db, h, patient)
    except NotConfigured as exc:
        return SendResult(ok=False, error_code="not_configured", error_message=str(exc))
    return fn(provider)


def reminder_payloads(r: ReminderSchedule) -> list[str]:
    return [f"TT1|CONFIRM|{r.id}", f"TT1|RESCHEDULE|{r.id}"]


def send_reminder(db: Session, h: Hospital, r: ReminderSchedule, patient: Patient) -> tuple[SendResult, WhatsAppMessage]:
    lang = patient.preferred_language
    if r.kind == ReminderKind.appointment_1d:
        appt = db.get(Appointment, r.appointment_id)
        purpose = P.appointment_reminder
        values = {"patient_name": patient.full_name, "hospital_name": h.name, "doctor_name": appt.doctor.name,
                  "date": tpl.fmt_date(appt.scheduled_date, lang), "time": tpl.fmt_time(appt.start_time)}
        ids = {"appointment_id": appt.id}
    else:
        fu = db.get(FollowUp, r.followup_id)
        purpose = P.followup_reminder
        values = {"patient_name": patient.full_name, "hospital_name": h.name, "doctor_name": fu.doctor.name,
                  "date": tpl.fmt_date(fu.due_date, lang), "days": str((fu.due_date - clock.today(h)).days)}
        ids = {"followup_id": fu.id}
    t = tpl.get(db, h, purpose, lang)
    params = [values[k] for k in tpl.TEMPLATE_PARAMS[purpose]]
    payloads = reminder_payloads(r)
    result = _send(db, h, patient, lambda p: p.send_template(digits(patient.phone), t.meta_name or "", t.meta_language_code or t.language.value, params, payloads))
    msg = _record(
        db, h, patient=patient, phone=patient.phone, result=result, kind="template", purpose=purpose.value,
        language=t.language.value, body=tpl.render_positional(t.body, params), reminder_id=r.id,
        buttons=[{"action": "CONFIRM", "label": t.confirm_label or "Confirm"},
                 {"action": "RESCHEDULE", "label": t.reschedule_label or "Reschedule"}],
        meta={"reminder_kind": r.kind.value, "template": t.meta_name}, **ids,
    )
    return result, msg


def send_reply(
    db: Session, h: Hospital, patient: Patient, purpose: P, values: dict, *, meta: dict | None = None,
    reminder_id=None, appointment_id=None, followup_id=None,
) -> WhatsAppMessage:
    t = tpl.get(db, h, purpose, patient.preferred_language)
    text = tpl.render_named(t.body, {"name": patient.full_name, "hospital": h.name, **values})
    result = _send(db, h, patient, lambda p: p.send_text(digits(patient.phone), text))
    return _record(db, h, patient=patient, phone=patient.phone, result=result, kind="text", purpose=purpose.value,
                   language=t.language.value, body=text, meta=meta, reminder_id=reminder_id,
                   appointment_id=appointment_id, followup_id=followup_id)


def send_test_message(db: Session, h: Hospital, phone: str) -> WhatsAppMessage:
    """Sends Meta's default 'hello_world' template — proves the live credentials can deliver a message."""
    result = _send(db, h, None, lambda p: p.send_template(digits(phone), "hello_world", "en_US", [], []))
    return _record(db, h, patient=None, phone=phone, result=result, kind="template", purpose="connection_test",
                   language="en", body="Hello World — WhatsApp connection test from TEC THA Follow-Up Engine")
