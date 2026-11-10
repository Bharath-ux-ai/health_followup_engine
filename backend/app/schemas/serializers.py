"""Response shaping. Explicit dicts keep sensitive fields (password hashes, tokens) from ever leaking."""
from app.models import (
    Appointment, Doctor, FollowUp, FollowUpContact, Hospital, MessageTemplate, Patient, ReminderSchedule, User,
    WhatsAppMessage,
)
from app.services import clock


def _t(v):
    return v.strftime("%H:%M") if v else None


def _iso(v):
    return v.isoformat() if v else None


def hospital_public(h: Hospital) -> dict:
    return {"name": h.name, "slug": h.slug, "city": h.city, "address": h.address, "phone": h.phone,
            "booking_enabled": h.booking_enabled and h.is_active, "booking_window_days": h.booking_window_days,
            "today": clock.today(h).isoformat(), "is_demo": h.is_demo}


def hospital(h: Hospital) -> dict:
    return {**hospital_public(h), "id": str(h.id), "email": h.email, "timezone": h.timezone,
            "reminder_send_time": _t(h.reminder_send_time), "default_language": h.default_language.value,
            "slot_minutes": h.slot_minutes, "is_active": h.is_active, "demo_clock": _iso(h.demo_now) if clock.demo_clock_active(h) else None,
            "now": clock.now(h).isoformat()}


def user(u: User) -> dict:
    return {"id": str(u.id), "email": u.email, "full_name": u.full_name, "role": u.role.code, "role_name": u.role.name,
            "is_active": u.is_active, "last_login_at": _iso(u.last_login_at), "hospital_id": str(u.hospital_id) if u.hospital_id else None,
            "permissions": sorted(u.role.permission_codes)}


def doctor(d: Doctor, with_availability: bool = True) -> dict:
    out = {"id": str(d.id), "name": d.name, "specialty": d.specialty, "is_active": d.is_active}
    if with_availability:
        out["availability"] = [{"weekday": w.weekday, "start_time": _t(w.start_time), "end_time": _t(w.end_time),
                                "slot_minutes": w.slot_minutes} for w in d.availability]
    return out


def patient_brief(p: Patient) -> dict:
    return {"id": str(p.id), "full_name": p.full_name, "phone": p.phone, "preferred_language": p.preferred_language.value,
            "whatsapp_consent": p.whatsapp_consent, "is_demo": p.is_demo}


def patient(p: Patient) -> dict:
    return {**patient_brief(p), "consent_at": _iso(p.consent_at), "consent_source": p.consent_source,
            "created_at": _iso(p.created_at)}


def reminder(r: ReminderSchedule | None, message: WhatsAppMessage | None = None) -> dict | None:
    if r is None:
        return None
    return {"id": str(r.id), "kind": r.kind.value, "status": r.status.value, "scheduled_for": _iso(r.scheduled_for),
            "target_date": r.target_date.isoformat(), "sent_at": _iso(r.sent_at), "attempts": r.attempts,
            "last_error": r.last_error, "skip_reason": r.skip_reason, "delivery_uncertain": r.delivery_uncertain,
            "response": r.response.value if r.response else None, "responded_at": _iso(r.responded_at),
            "message_status": message.status.value if message else None,
            "simulated": message.is_simulated if message else None}


def appointment(a: Appointment, rem: dict | None = None) -> dict:
    return {"id": str(a.id), "reference": a.reference, "date": a.scheduled_date.isoformat(), "start_time": _t(a.start_time),
            "end_time": _t(a.end_time), "status": a.status.value, "source": a.source.value,
            "patient": patient_brief(a.patient), "doctor": doctor(a.doctor, False), "followup_id": str(a.followup_id) if a.followup_id else None,
            "booked_at": _iso(a.booked_at), "confirmed_at": _iso(a.confirmed_at), "confirmed_via": a.confirmed_via,
            "cancelled_at": _iso(a.cancelled_at), "cancel_reason": a.cancel_reason, "completed_at": _iso(a.completed_at),
            "reschedule_count": a.reschedule_count, "reminder": rem}


def followup(f: FollowUp, attention: str | None = None, reminders: list[dict] | None = None,
             visit: Appointment | None = None) -> dict:
    return {"id": str(f.id), "due_date": f.due_date.isoformat(), "original_due_date": f.original_due_date.isoformat(),
            "status": f.status.value, "attention": attention, "patient": patient_brief(f.patient), "doctor": doctor(f.doctor, False),
            "source_appointment_id": str(f.source_appointment_id), "confirmed_at": _iso(f.confirmed_at),
            "rescheduled_at": _iso(f.rescheduled_at), "completed_at": _iso(f.completed_at), "missed_at": _iso(f.missed_at),
            "last_contacted_at": _iso(f.last_contacted_at), "contact_count": f.contact_count,
            "reminders": reminders or [],
            "visit": {"id": str(visit.id), "reference": visit.reference, "date": visit.scheduled_date.isoformat(),
                      "start_time": _t(visit.start_time), "status": visit.status.value} if visit else None}


def contact(c: FollowUpContact, by: str | None = None) -> dict:
    return {"id": str(c.id), "outcome": c.outcome, "note": c.note, "contacted_at": _iso(c.contacted_at), "by": by}


def message(m: WhatsAppMessage) -> dict:
    return {"id": str(m.id), "direction": m.direction.value, "kind": m.kind, "purpose": m.purpose, "language": m.language,
            "body": m.body, "buttons": m.buttons or [], "meta": m.meta or {}, "status": m.status.value,
            "is_simulated": m.is_simulated, "error_code": m.error_code, "error_message": m.error_message,
            "occurred_at": _iso(m.occurred_at), "delivered_at": _iso(m.delivered_at), "read_at": _iso(m.read_at),
            "reminder_id": str(m.reminder_id) if m.reminder_id else None, "patient_id": str(m.patient_id) if m.patient_id else None,
            "appointment_id": str(m.appointment_id) if m.appointment_id else None,
            "followup_id": str(m.followup_id) if m.followup_id else None, "wamid": m.wamid}


def template(t: MessageTemplate) -> dict:
    return {"id": str(t.id), "purpose": t.purpose.value, "language": t.language.value, "meta_name": t.meta_name,
            "meta_language_code": t.meta_language_code, "body": t.body, "confirm_label": t.confirm_label,
            "reschedule_label": t.reschedule_label, "approval_status": t.approval_status.value,
            "last_synced_at": _iso(t.last_synced_at), "updated_at": _iso(t.updated_at)}
