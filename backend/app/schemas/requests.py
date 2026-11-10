"""Pydantic request bodies (input validation)."""
import uuid
from datetime import date, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.enums import AppointmentStatus, FollowUpStatus, Language, TemplateApproval, WhatsAppMode


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ---- auth ---------------------------------------------------------------------
class LoginIn(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class ForgotPasswordIn(Strict):
    email: EmailStr


class ResetPasswordIn(Strict):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=10, max_length=200)


class ChangePasswordIn(Strict):
    current_password: str = Field(max_length=200)
    new_password: str = Field(min_length=10, max_length=200)


# ---- booking ------------------------------------------------------------------
class PatientIn(Strict):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=8, max_length=20)
    language: Language = Language.en
    whatsapp_consent: bool = False


class PublicBookingIn(PatientIn):
    doctor_id: uuid.UUID
    date: date
    start_time: time
    website: str = Field("", max_length=0)  # honeypot: must stay empty


class StaffBookingIn(PatientIn):
    doctor_id: uuid.UUID
    date: date
    start_time: time
    mark_confirmed: bool = False


class StatusIn(Strict):
    status: AppointmentStatus
    reason: str | None = Field(None, max_length=200)


class RescheduleIn(Strict):
    date: date
    start_time: time
    doctor_id: uuid.UUID | None = None
    mark_confirmed: bool = False


class PublicRescheduleIn(Strict):
    date: date
    start_time: time


# ---- follow-ups ----------------------------------------------------------------
class FollowUpCreateIn(Strict):
    due_date: date


class FollowUpDateIn(Strict):
    due_date: date


class FollowUpStatusIn(Strict):
    status: Literal[FollowUpStatus.completed, FollowUpStatus.cancelled]


class FollowUpBookIn(Strict):
    date: date
    start_time: time


class ContactIn(Strict):
    outcome: Literal["reached", "no_answer", "wrong_number", "will_visit", "declined"]
    note: str | None = Field(None, max_length=240)


# ---- patients -------------------------------------------------------------------
class PatientUpdateIn(Strict):
    full_name: str | None = Field(None, min_length=2, max_length=120)
    phone: str | None = Field(None, min_length=8, max_length=20)
    preferred_language: Language | None = None
    whatsapp_consent: bool | None = None


# ---- hospital admin ----------------------------------------------------------------
class HospitalUpdateIn(Strict):
    name: str | None = Field(None, min_length=2, max_length=160)
    phone: str | None = Field(None, max_length=20)
    email: EmailStr | None = None
    address: str | None = Field(None, max_length=300)
    city: str | None = Field(None, max_length=80)
    timezone: str | None = Field(None, max_length=64)
    reminder_send_time: time | None = None
    default_language: Language | None = None
    slot_minutes: int | None = Field(None, ge=5, le=120)
    booking_window_days: int | None = Field(None, ge=1, le=180)
    booking_enabled: bool | None = None

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v):
        if v is not None:
            from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
            try:
                ZoneInfo(v)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValueError("Unknown timezone")
        return v


class AvailabilityWindowIn(Strict):
    weekday: int = Field(ge=0, le=6)
    start_time: time
    end_time: time
    slot_minutes: int | None = Field(None, ge=5, le=120)


class DoctorIn(Strict):
    name: str = Field(min_length=2, max_length=120)
    specialty: str | None = Field(None, max_length=120)
    is_active: bool = True
    availability: list[AvailabilityWindowIn] = Field(default_factory=list, max_length=42)


class StaffCreateIn(Strict):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    role: Literal["hospital_admin", "hospital_staff"] = "hospital_staff"
    password: str = Field(min_length=10, max_length=200)


class StaffUpdateIn(Strict):
    full_name: str | None = Field(None, min_length=2, max_length=120)
    role: Literal["hospital_admin", "hospital_staff"] | None = None
    is_active: bool | None = None


class StaffPasswordIn(Strict):
    password: str = Field(min_length=10, max_length=200)


# ---- WhatsApp ----------------------------------------------------------------------
class WhatsAppConfigIn(Strict):
    mode: WhatsAppMode | None = None
    phone_number_id: str | None = Field(None, max_length=64, pattern=r"^\d*$")
    waba_id: str | None = Field(None, max_length=64, pattern=r"^\d*$")
    access_token: str | None = Field(None, max_length=1000)  # write-only
    app_secret: str | None = Field(None, max_length=200)  # write-only


class TestMessageIn(Strict):
    phone: str = Field(min_length=8, max_length=20)


class TemplateUpdateIn(Strict):
    body: str | None = Field(None, min_length=1, max_length=1024)
    meta_name: str | None = Field(None, max_length=120, pattern=r"^[a-z0-9_]*$")
    confirm_label: str | None = Field(None, min_length=1, max_length=20)
    reschedule_label: str | None = Field(None, min_length=1, max_length=20)
    approval_status: TemplateApproval | None = None


class SimulateTapIn(Strict):
    message_id: uuid.UUID
    action: Literal["CONFIRM", "RESCHEDULE"]


class RetryIn(Strict):
    confirm_uncertain: bool = False


# ---- system admin ----------------------------------------------------------------------
class HospitalOnboardIn(Strict):
    name: str = Field(min_length=2, max_length=160)
    slug: str = Field(min_length=3, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    city: str | None = Field(None, max_length=80)
    phone: str | None = Field(None, max_length=20)
    admin_name: str = Field(min_length=2, max_length=120)
    admin_email: EmailStr
    admin_password: str = Field(min_length=10, max_length=200)


class HospitalAdminPatchIn(Strict):
    is_active: bool | None = None


class PlatformSettingsIn(Strict):
    support_email: EmailStr | None = None
    support_phone: str | None = Field(None, max_length=20)
    default_reminder_time: time | None = None
    default_timezone: str | None = Field(None, max_length=64)


# ---- demo ---------------------------------------------------------------------------------
class DemoClockIn(Strict):
    set_to: str | None = Field(None, max_length=40)  # ISO local datetime, e.g. 2026-11-10T18:05
    advance_days: int | None = Field(None, ge=-60, le=60)
    advance_hours: int | None = Field(None, ge=-48, le=48)
    reset_to_real: bool = False
