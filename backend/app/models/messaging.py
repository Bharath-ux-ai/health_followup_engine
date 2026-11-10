"""WhatsApp configuration, templates, messages, delivery logs and reminder schedules."""
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UTCDateTime, UUIDPk
from app.models.enums import (
    Language, MessageDirection, MessageStatus, ReminderKind, ReminderResponse, ReminderStatus, TemplateApproval,
    TemplatePurpose, WhatsAppMode, db_enum,
)

JSONType = JSON().with_variant(JSONB(), "postgresql")


class WhatsAppConfig(UUIDPk, Timestamps, Base):
    __tablename__ = "whatsapp_configs"
    hospital_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"), unique=True)
    mode: Mapped[WhatsAppMode] = mapped_column(db_enum(WhatsAppMode, "whatsapp_mode"), default=WhatsAppMode.simulation)
    phone_number_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    waba_id: Mapped[str | None] = mapped_column(String(64))
    display_phone_number: Mapped[str | None] = mapped_column(String(32))
    verified_name: Mapped[str | None] = mapped_column(String(160))
    access_token_enc: Mapped[str | None] = mapped_column(Text)  # Fernet-encrypted, never returned by the API
    app_secret_enc: Mapped[str | None] = mapped_column(Text)  # optional per-hospital Meta app secret
    last_verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_error: Mapped[str | None] = mapped_column(String(400))


class MessageTemplate(UUIDPk, Timestamps, Base):
    __tablename__ = "message_templates"
    hospital_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"))
    purpose: Mapped[TemplatePurpose] = mapped_column(db_enum(TemplatePurpose, "template_purpose"))
    language: Mapped[Language] = mapped_column(db_enum(Language, "language"))
    meta_name: Mapped[str | None] = mapped_column(String(120))  # approved template name in WhatsApp Manager
    meta_language_code: Mapped[str | None] = mapped_column(String(10))
    body: Mapped[str] = mapped_column(Text)
    confirm_label: Mapped[str | None] = mapped_column(String(20))
    reschedule_label: Mapped[str | None] = mapped_column(String(20))
    approval_status: Mapped[TemplateApproval] = mapped_column(db_enum(TemplateApproval, "template_approval"))
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    __table_args__ = (UniqueConstraint("hospital_id", "purpose", "language", name="uq_message_templates_purpose_lang"),)


class ReminderSchedule(UUIDPk, Timestamps, Base):
    __tablename__ = "reminder_schedules"
    hospital_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"))
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    kind: Mapped[ReminderKind] = mapped_column(db_enum(ReminderKind, "reminder_kind"))
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("appointments.id", ondelete="CASCADE"), index=True)
    followup_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("followups.id", ondelete="CASCADE"), index=True)
    target_date: Mapped[date] = mapped_column(Date)  # visit / follow-up date this reminder is about
    scheduled_for: Mapped[datetime] = mapped_column(UTCDateTime)
    status: Mapped[ReminderStatus] = mapped_column(db_enum(ReminderStatus, "reminder_status"), default=ReminderStatus.pending)
    # Idempotency: one reminder per (kind, entity, target date) — prevents duplicate delivery forever.
    idempotency_key: Mapped[str] = mapped_column(String(120), unique=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(String(400))
    skip_reason: Mapped[str | None] = mapped_column(String(160))
    delivery_uncertain: Mapped[bool] = mapped_column(Boolean, default=False)  # timeout after request sent
    locked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    message_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("whatsapp_messages.id", ondelete="SET NULL", use_alter=True))
    response: Mapped[ReminderResponse | None] = mapped_column(db_enum(ReminderResponse, "reminder_response"))
    responded_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    __table_args__ = (
        Index("ix_reminders_due", "status", "scheduled_for"),
        Index("ix_reminders_hospital_status", "hospital_id", "status"),
    )


class WhatsAppMessage(UUIDPk, Timestamps, Base):
    __tablename__ = "whatsapp_messages"
    hospital_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"))
    patient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("patients.id", ondelete="SET NULL"))
    reminder_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reminder_schedules.id", ondelete="SET NULL"), index=True)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("appointments.id", ondelete="SET NULL"))
    followup_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("followups.id", ondelete="SET NULL"))
    direction: Mapped[MessageDirection] = mapped_column(db_enum(MessageDirection, "message_direction"))
    kind: Mapped[str] = mapped_column(String(16))  # template | text | button
    purpose: Mapped[str | None] = mapped_column(String(40))
    language: Mapped[str | None] = mapped_column(String(8))
    phone: Mapped[str] = mapped_column(String(20))  # patient's number (recipient or sender)
    body: Mapped[str] = mapped_column(Text)
    buttons: Mapped[list | None] = mapped_column(JSONType)  # [{"action": "CONFIRM", "label": "Confirm"}]
    meta: Mapped[dict | None] = mapped_column(JSONType)  # e.g. {"reschedule_url": ...}
    wamid: Mapped[str | None] = mapped_column(String(160), unique=True)  # WhatsApp message id
    status: Mapped[MessageStatus] = mapped_column(db_enum(MessageStatus, "message_status"))
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    error_code: Mapped[str | None] = mapped_column(String(32))
    error_message: Mapped[str | None] = mapped_column(String(400))
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime)  # business time (hospital clock)
    delivered_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    failed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    delivery_logs: Mapped[list["MessageDeliveryLog"]] = relationship(
        back_populates="message", cascade="all, delete-orphan", order_by="MessageDeliveryLog.created_at"
    )

    __table_args__ = (Index("ix_messages_conversation", "hospital_id", "patient_id", "occurred_at"),)


class MessageDeliveryLog(UUIDPk, Timestamps, Base):
    __tablename__ = "message_delivery_logs"
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("whatsapp_messages.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(24))
    detail: Mapped[str | None] = mapped_column(String(400))
    raw: Mapped[dict | None] = mapped_column(JSONType)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime)

    message: Mapped[WhatsAppMessage] = relationship(back_populates="delivery_logs")
