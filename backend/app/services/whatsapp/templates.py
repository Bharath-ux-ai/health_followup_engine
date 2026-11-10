"""Default English/Tamil message templates and rendering helpers.

* appointment_reminder / followup_reminder are WhatsApp *template* messages (business-initiated). They must be
  created in WhatsApp Manager and approved by Meta before live sending. Body variables are positional ({{1}}…).
* *_reply purposes are free-form replies sent inside the 24-hour customer-service window opened when the patient
  taps a button, so they do not need Meta approval. They use named placeholders ({name}, {date}, …).
"""
import re
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Hospital, MessageTemplate
from app.models.enums import Language, TemplateApproval, TemplatePurpose as P

# Positional parameter order for Meta templates.
TEMPLATE_PARAMS: dict[P, list[str]] = {
    P.appointment_reminder: ["patient_name", "hospital_name", "doctor_name", "date", "time"],
    P.followup_reminder: ["patient_name", "hospital_name", "doctor_name", "date", "days"],
}
META_TEMPLATE_PURPOSES = set(TEMPLATE_PARAMS)
REPLY_PLACEHOLDERS = ["name", "hospital", "doctor", "date", "time", "reference", "link"]

DEFAULTS: dict[tuple[P, Language], dict] = {
    (P.appointment_reminder, Language.en): {
        "meta_name": "appointment_reminder_v1",
        "body": "Hello {{1}},\n\nThis is a reminder from {{2}}.\n\nYour appointment with {{3}} is scheduled for "
                "tomorrow, {{4}} at {{5}}.\n\nPlease confirm your appointment.",
        "confirm_label": "Confirm", "reschedule_label": "Reschedule",
    },
    (P.appointment_reminder, Language.ta): {
        "meta_name": "appointment_reminder_v1",
        "body": "வணக்கம் {{1}},\n\n{{2}} இலிருந்து ஒரு நினைவூட்டல்.\n\n{{3}} அவர்களுடன் உங்கள் சந்திப்பு நாளை, "
                "{{4}} அன்று {{5}} மணிக்கு உள்ளது.\n\nதயவுசெய்து உங்கள் வருகையை உறுதிசெய்யுங்கள்.",
        "confirm_label": "உறுதிசெய்", "reschedule_label": "நேரம் மாற்று",
    },
    (P.followup_reminder, Language.en): {
        "meta_name": "followup_reminder_v1",
        "body": "Hello {{1}},\n\nThis is a reminder from {{2}}.\n\nYour follow-up visit with {{3}} is due on {{4}}, "
                "{{5}} days from today.\n\nTap Confirm to book your visit, or Reschedule to choose another date.",
        "confirm_label": "Confirm", "reschedule_label": "Reschedule",
    },
    (P.followup_reminder, Language.ta): {
        "meta_name": "followup_reminder_v1",
        "body": "வணக்கம் {{1}},\n\n{{2}} இலிருந்து ஒரு நினைவூட்டல்.\n\n{{3}} அவர்களுடன் உங்கள் மறுபரிசோதனை வருகை "
                "{{4}} அன்று உள்ளது, இன்னும் {{5}} நாட்கள்.\n\nவருகையை பதிவு செய்ய 'உறுதிசெய்' அல்லது வேறு தேதிக்கு "
                "'நேரம் மாற்று' அழுத்தவும்.",
        "confirm_label": "உறுதிசெய்", "reschedule_label": "நேரம் மாற்று",
    },
    (P.appointment_confirmed_reply, Language.en): {
        "body": "Thank you, {name}. Your appointment with {doctor} on {date} at {time} is confirmed. See you at {hospital}."},
    (P.appointment_confirmed_reply, Language.ta): {
        "body": "நன்றி {name}. {date} அன்று {time} மணிக்கு {doctor} அவர்களுடன் உங்கள் சந்திப்பு உறுதிசெய்யப்பட்டது. "
                "{hospital} இல் சந்திப்போம்."},
    (P.appointment_reschedule_reply, Language.en): {
        "body": "No problem, {name}. Please choose a new time here: {link}\nOur team may also call you to help."},
    (P.appointment_reschedule_reply, Language.ta): {
        "body": "சரி {name}. புதிய நேரத்தை இங்கே தேர்வு செய்யவும்: {link}\nஎங்கள் குழுவும் உங்களை அழைக்கலாம்."},
    (P.followup_booked_reply, Language.en): {
        "body": "Thank you, {name}. Your follow-up visit with {doctor} is booked for {date} at {time}. "
                "Appointment ID: {reference}. Need another time? {link}"},
    (P.followup_booked_reply, Language.ta): {
        "body": "நன்றி {name}. {doctor} அவர்களுடன் உங்கள் மறுபரிசோதனை வருகை {date} அன்று {time} மணிக்கு பதிவு "
                "செய்யப்பட்டது. சந்திப்பு எண்: {reference}. வேறு நேரம் வேண்டுமா? {link}"},
    (P.followup_reschedule_reply, Language.en): {
        "body": "No problem, {name}. Please choose a convenient date and time for your follow-up visit here: {link}"},
    (P.followup_reschedule_reply, Language.ta): {
        "body": "சரி {name}. உங்கள் மறுபரிசோதனை வருகைக்கான தேதி மற்றும் நேரத்தை இங்கே தேர்வு செய்யவும்: {link}"},
    (P.rescheduled_reply, Language.en): {
        "body": "Done, {name}. Your appointment with {doctor} is now on {date} at {time}. Appointment ID: {reference}."},
    (P.rescheduled_reply, Language.ta): {
        "body": "முடிந்தது {name}. {doctor} அவர்களுடன் உங்கள் சந்திப்பு இப்போது {date} அன்று {time} மணிக்கு. "
                "சந்திப்பு எண்: {reference}."},
}

_TA_DAYS = ["திங்கள்", "செவ்வாய்", "புதன்", "வியாழன்", "வெள்ளி", "சனி", "ஞாயிறு"]
_TA_MONTHS = ["ஜனவரி", "பிப்ரவரி", "மார்ச்", "ஏப்ரல்", "மே", "ஜூன்", "ஜூலை", "ஆகஸ்ட்", "செப்டம்பர்", "அக்டோபர்", "நவம்பர்", "டிசம்பர்"]


def fmt_date(d: date, lang: Language) -> str:
    if lang == Language.ta:
        return f"{_TA_DAYS[d.weekday()]}, {d.day} {_TA_MONTHS[d.month - 1]}"
    return d.strftime("%a, %d %b").replace(" 0", " ")


def fmt_time(t: time) -> str:
    return t.strftime("%I:%M %p").lstrip("0")


def seed_defaults(db: Session, h: Hospital) -> None:
    existing = {(t.purpose, t.language) for t in db.scalars(select(MessageTemplate).where(MessageTemplate.hospital_id == h.id))}
    for (purpose, lang), d in DEFAULTS.items():
        if (purpose, lang) in existing:
            continue
        is_meta = purpose in META_TEMPLATE_PURPOSES
        db.add(MessageTemplate(
            hospital_id=h.id, purpose=purpose, language=lang, body=d["body"],
            meta_name=d.get("meta_name"), meta_language_code=lang.value if is_meta else None,
            confirm_label=d.get("confirm_label"), reschedule_label=d.get("reschedule_label"),
            approval_status=TemplateApproval.not_submitted if is_meta else TemplateApproval.not_required,
        ))
    db.flush()


def get(db: Session, h: Hospital, purpose: P, lang: Language) -> MessageTemplate:
    t = db.scalar(select(MessageTemplate).where(
        MessageTemplate.hospital_id == h.id, MessageTemplate.purpose == purpose, MessageTemplate.language == lang))
    if t is None and lang != Language.en:
        return get(db, h, purpose, Language.en)
    if t is None:
        seed_defaults(db, h)
        return get(db, h, purpose, lang)
    return t


def render_positional(body: str, params: list[str]) -> str:
    return re.sub(r"\{\{(\d+)\}\}", lambda m: params[int(m.group(1)) - 1] if int(m.group(1)) <= len(params) else m.group(0), body)


def render_named(body: str, values: dict[str, str]) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: str(values.get(m.group(1), m.group(0))), body)


def validate_body(purpose: P, body: str) -> None:
    from app.services.errors import InvalidInput
    if not body.strip() or len(body) > 1024:
        raise InvalidInput("Message body must be between 1 and 1024 characters")
    if purpose in META_TEMPLATE_PURPOSES:
        used = {int(n) for n in re.findall(r"\{\{(\d+)\}\}", body)}
        allowed = set(range(1, len(TEMPLATE_PARAMS[purpose]) + 1))
        if not used <= allowed:
            raise InvalidInput(f"Only variables {{{{1}}}}–{{{{{max(allowed)}}}}} are available for this template")
    else:
        unknown = set(re.findall(r"\{(\w+)\}", body)) - set(REPLY_PLACEHOLDERS)
        if unknown:
            raise InvalidInput(f"Unknown placeholder(s): {', '.join(sorted(unknown))}")
