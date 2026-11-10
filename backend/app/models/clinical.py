"""Patients, appointments and follow-ups. Deliberately contains no medical information (V1 has no health records)."""
import uuid
from datetime import date, datetime, time

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, String, Time, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDelete, Timestamps, UTCDateTime, UUIDPk
from app.models.core import Doctor
from app.models.enums import AppointmentSource, AppointmentStatus, FollowUpStatus, Language, db_enum


class Patient(UUIDPk, Timestamps, SoftDelete, Base):
    __tablename__ = "patients"

    hospital_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"))
    full_name: Mapped[str] = mapped_column(String(120))
    name_key: Mapped[str] = mapped_column(String(120))  # normalised name for de-duplication
    phone: Mapped[str] = mapped_column(String(20))  # E.164, e.g. +919876543210
    preferred_language: Mapped[Language] = mapped_column(db_enum(Language, "language"), default=Language.en)
    # Consent to receive WhatsApp reminders (required before any message is sent).
    whatsapp_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    consent_source: Mapped[str | None] = mapped_column(String(32))  # booking_form | staff | whatsapp_stop
    # Fictional demo patients: messages are always simulated, never sent through WhatsApp.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (
        # One record per (hospital, phone, name) — family members sharing a phone stay separate.
        Index("uq_patients_identity", "hospital_id", "phone", "name_key", unique=True,
              postgresql_where=text("deleted_at IS NULL"), sqlite_where=text("deleted_at IS NULL")),
        Index("ix_patients_hospital_phone", "hospital_id", "phone"),
    )


class Appointment(UUIDPk, Timestamps, Base):
    __tablename__ = "appointments"

    hospital_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"))
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="RESTRICT"), index=True)
    doctor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctors.id", ondelete="RESTRICT"))
    followup_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("followups.id", ondelete="SET NULL", use_alter=True), index=True
    )
    reference: Mapped[str] = mapped_column(String(12), unique=True)  # human-friendly appointment ID
    scheduled_date: Mapped[date] = mapped_column(Date)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime)
    status: Mapped[AppointmentStatus] = mapped_column(db_enum(AppointmentStatus, "appointment_status"), default=AppointmentStatus.booked)
    source: Mapped[AppointmentSource] = mapped_column(db_enum(AppointmentSource, "appointment_source"))
    # Double-booking guard: "<doctor>|<date>|<time>" while active, NULL once cancelled. Unique at DB level.
    slot_key: Mapped[str | None] = mapped_column(String(96), unique=True)
    booked_at: Mapped[datetime] = mapped_column(UTCDateTime)
    confirmed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    confirmed_via: Mapped[str | None] = mapped_column(String(16))  # whatsapp | staff | patient_link
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    cancel_reason: Mapped[str | None] = mapped_column(String(200))
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    no_show_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    reschedule_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    patient: Mapped[Patient] = relationship(lazy="joined")
    doctor: Mapped[Doctor] = relationship(lazy="joined")

    __table_args__ = (
        Index("ix_appointments_hospital_date", "hospital_id", "scheduled_date"),
        Index("ix_appointments_hospital_status", "hospital_id", "status"),
    )


class FollowUp(UUIDPk, Timestamps, Base):
    __tablename__ = "followups"

    hospital_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"))
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id", ondelete="RESTRICT"), index=True)
    source_appointment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("appointments.id", ondelete="RESTRICT"))
    doctor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctors.id", ondelete="RESTRICT"))
    due_date: Mapped[date] = mapped_column(Date)
    original_due_date: Mapped[date] = mapped_column(Date)
    status: Mapped[FollowUpStatus] = mapped_column(db_enum(FollowUpStatus, "followup_status"), default=FollowUpStatus.scheduled)
    confirmed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    rescheduled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    missed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_contacted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    contact_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    patient: Mapped[Patient] = relationship(lazy="joined")
    doctor: Mapped[Doctor] = relationship(lazy="joined")
    source_appointment: Mapped[Appointment] = relationship(foreign_keys=[source_appointment_id])

    __table_args__ = (
        Index("ix_followups_hospital_due", "hospital_id", "due_date"),
        Index("ix_followups_hospital_status", "hospital_id", "status"),
        # At most one live follow-up per source visit (prevents duplicate follow-ups + duplicate reminders).
        Index("uq_followups_source_open", "source_appointment_id", unique=True,
              postgresql_where=text("status <> 'cancelled'"), sqlite_where=text("status <> 'cancelled'")),
    )


class FollowUpContact(UUIDPk, Timestamps, Base):
    """Staff contact attempts for a follow-up (e.g. phone call after no WhatsApp response)."""

    __tablename__ = "followup_contacts"
    hospital_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"))
    followup_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("followups.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    outcome: Mapped[str] = mapped_column(String(24))  # reached | no_answer | wrong_number | will_visit | declined
    note: Mapped[str | None] = mapped_column(String(240))
    contacted_at: Mapped[datetime] = mapped_column(UTCDateTime)
