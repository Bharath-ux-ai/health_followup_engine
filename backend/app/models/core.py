"""Hospitals, users, roles/permissions, doctors and availability."""
import uuid
from datetime import datetime, time

from sqlalchemy import (
    Boolean, CheckConstraint, Column, ForeignKey, Index, Integer, SmallInteger, String, Table, Time, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDelete, Timestamps, UTCDateTime, UUIDPk
from app.models.enums import Language, db_enum


class Hospital(UUIDPk, Timestamps, SoftDelete, Base):
    __tablename__ = "hospitals"

    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(160))
    address: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(80))
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    reminder_send_time: Mapped[time] = mapped_column(Time, default=time(18, 0))
    default_language: Mapped[Language] = mapped_column(db_enum(Language, "language"), default=Language.en)
    slot_minutes: Mapped[int] = mapped_column(SmallInteger, default=15)
    booking_window_days: Mapped[int] = mapped_column(SmallInteger, default=30)
    booking_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Demo isolation: only hospitals flagged is_demo may use the demo clock and simulation tools.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    demo_now: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    __table_args__ = (
        CheckConstraint("slot_minutes BETWEEN 5 AND 120", name="slot_minutes_range"),
        CheckConstraint("booking_window_days BETWEEN 1 AND 180", name="booking_window_range"),
    )


role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)


class Permission(Base):
    __tablename__ = "permissions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    description: Mapped[str] = mapped_column(String(200))


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    permissions: Mapped[list[Permission]] = relationship(secondary=role_permissions, lazy="selectin")

    @property
    def permission_codes(self) -> set[str]:
        return {p.code for p in self.permissions}


class User(UUIDPk, Timestamps, SoftDelete, Base):
    __tablename__ = "users"

    hospital_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("hospitals.id", ondelete="RESTRICT"), index=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    email: Mapped[str] = mapped_column(String(160), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    token_version: Mapped[int] = mapped_column(Integer, default=1)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    role: Mapped[Role] = relationship(lazy="joined")
    hospital: Mapped[Hospital | None] = relationship(lazy="joined")


class PasswordResetToken(UUIDPk, Timestamps, Base):
    __tablename__ = "password_reset_tokens"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class Doctor(UUIDPk, Timestamps, SoftDelete, Base):
    __tablename__ = "doctors"
    hospital_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    specialty: Mapped[str | None] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    availability: Mapped[list["DoctorAvailability"]] = relationship(
        back_populates="doctor", cascade="all, delete-orphan", order_by="(DoctorAvailability.weekday, DoctorAvailability.start_time)"
    )


class DoctorAvailability(UUIDPk, Timestamps, Base):
    """Weekly recurring consultation window for a doctor. weekday: 0=Monday … 6=Sunday."""

    __tablename__ = "doctor_availability"
    hospital_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"))
    doctor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctors.id", ondelete="CASCADE"))
    weekday: Mapped[int] = mapped_column(SmallInteger)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    slot_minutes: Mapped[int | None] = mapped_column(SmallInteger)  # overrides hospital default

    doctor: Mapped[Doctor] = relationship(back_populates="availability")

    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="weekday_range"),
        CheckConstraint("end_time > start_time", name="window_order"),
        Index("ix_doctor_availability_doctor_weekday", "doctor_id", "weekday"),
        UniqueConstraint("doctor_id", "weekday", "start_time", name="uq_doctor_availability_window"),
    )
