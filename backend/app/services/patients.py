import re

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Hospital, Patient
from app.models.enums import Language
from app.services import clock
from app.services.errors import InvalidInput
from app.services.phone import normalize_phone

_HONORIFICS = {"mr", "mrs", "ms", "miss", "dr", "shri", "smt", "thiru", "tmt", "selvi"}


def clean_name(name: str) -> str:
    name = " ".join(name.split())
    if not (2 <= len(name) <= 120) or not re.search(r"[^\W\d_]", name):
        raise InvalidInput("Enter the patient's name")
    return name


def name_key(name: str) -> str:
    parts = [p for p in re.sub(r"[^\w\s]", " ", name.lower()).split() if p]
    while len(parts) > 1 and parts[0] in _HONORIFICS:
        parts = parts[1:]
    return " ".join(parts)


def find_or_create(
    db: Session, h: Hospital, *, full_name: str, phone: str, language: Language | None = None,
    consent: bool = False, consent_source: str | None = None, is_demo: bool = False,
) -> Patient:
    """De-duplicates on (hospital, phone, normalised name). Consent is only ever granted here, never revoked."""
    full_name = clean_name(full_name)
    e164 = normalize_phone(phone)
    key = name_key(full_name)

    def lookup() -> Patient | None:
        return db.scalar(select(Patient).where(
            Patient.hospital_id == h.id, Patient.phone == e164, Patient.name_key == key, Patient.deleted_at.is_(None)
        ))

    patient = lookup()
    if patient is None:
        patient = Patient(
            hospital_id=h.id, full_name=full_name, name_key=key, phone=e164,
            preferred_language=language or h.default_language, is_demo=is_demo,
        )
        try:
            with db.begin_nested():
                db.add(patient)
                db.flush()
        except IntegrityError:  # created concurrently
            patient = lookup()
            assert patient is not None
    elif language:
        patient.preferred_language = language

    if consent and not patient.whatsapp_consent:
        set_consent(db, h, patient, True, consent_source or "booking_form")
    return patient


def set_consent(db: Session, h: Hospital, patient: Patient, value: bool, source: str) -> None:
    patient.whatsapp_consent = value
    patient.consent_at = clock.now(h)
    patient.consent_source = source
    if not value:
        from app.services import reminders  # cancel anything queued once consent is withdrawn
        reminders.cancel_for_patient(db, patient.id, "Patient withdrew WhatsApp consent")
