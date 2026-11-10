from enum import StrEnum

from sqlalchemy import Enum as SAEnum


def db_enum(enum_cls, name: str):
    """Portable enum column: VARCHAR + CHECK constraint (works on PostgreSQL and SQLite)."""
    return SAEnum(
        enum_cls, name=name, native_enum=False, create_constraint=True, length=32,
        values_callable=lambda e: [m.value for m in e], validate_strings=True,
    )


class Language(StrEnum):
    en = "en"
    ta = "ta"


class AppointmentStatus(StrEnum):
    booked = "booked"  # awaiting confirmation
    confirmed = "confirmed"
    reschedule_requested = "reschedule_requested"
    cancelled = "cancelled"
    completed = "completed"
    no_show = "no_show"


ACTIVE_APPOINTMENT_STATUSES = {AppointmentStatus.booked, AppointmentStatus.confirmed, AppointmentStatus.reschedule_requested}


class AppointmentSource(StrEnum):
    online = "online"  # public booking link
    staff = "staff"  # registered at reception
    followup = "followup"  # booked from a follow-up reminder


class FollowUpStatus(StrEnum):
    scheduled = "scheduled"  # reminders pending / awaiting patient response
    confirmed = "confirmed"  # patient confirmed, visit booked on due date
    rescheduled = "rescheduled"  # patient chose another date, visit booked
    completed = "completed"  # patient returned (visit recorded)
    missed = "missed"  # overdue: due date passed without a recorded visit
    cancelled = "cancelled"


OPEN_FOLLOWUP_STATUSES = {FollowUpStatus.scheduled, FollowUpStatus.confirmed, FollowUpStatus.rescheduled}


class ReminderKind(StrEnum):
    appointment_1d = "appointment_1d"
    followup_7d = "followup_7d"
    followup_3d = "followup_3d"


class ReminderStatus(StrEnum):
    pending = "pending"
    processing = "processing"
    sent = "sent"  # accepted by WhatsApp API, or recorded in simulation (see message.is_simulated)
    failed = "failed"
    cancelled = "cancelled"
    skipped = "skipped"


class ReminderResponse(StrEnum):
    confirmed = "confirmed"
    reschedule_requested = "reschedule_requested"


class WhatsAppMode(StrEnum):
    simulation = "simulation"  # nothing leaves the server; conversation shown in the simulator
    live = "live"  # WhatsApp Business Platform Cloud API


class MessageDirection(StrEnum):
    outbound = "outbound"
    inbound = "inbound"


class MessageStatus(StrEnum):
    simulated = "simulated"  # demo/simulation only — NOT delivered through WhatsApp
    sent = "sent"  # accepted by the Cloud API (has wamid)
    delivered = "delivered"
    read = "read"
    failed = "failed"
    received = "received"  # inbound from patient


class TemplatePurpose(StrEnum):
    appointment_reminder = "appointment_reminder"
    followup_reminder = "followup_reminder"
    appointment_confirmed_reply = "appointment_confirmed_reply"
    appointment_reschedule_reply = "appointment_reschedule_reply"
    followup_booked_reply = "followup_booked_reply"
    followup_reschedule_reply = "followup_reschedule_reply"
    rescheduled_reply = "rescheduled_reply"


class TemplateApproval(StrEnum):
    not_required = "not_required"  # free-form replies inside the 24h customer-service window
    not_submitted = "not_submitted"
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
