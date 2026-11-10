"""Monthly report snapshots, audit log and platform settings."""
import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, SmallInteger, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UTCDateTime, UUIDPk
from app.models.messaging import JSONType


class MonthlyReport(UUIDPk, Timestamps, Base):
    __tablename__ = "monthly_reports"
    hospital_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"))
    year: Mapped[int] = mapped_column(SmallInteger)
    month: Mapped[int] = mapped_column(SmallInteger)
    metrics: Mapped[dict] = mapped_column(JSONType)
    generated_at: Mapped[datetime] = mapped_column(UTCDateTime)
    generated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (UniqueConstraint("hospital_id", "year", "month", name="uq_monthly_reports_period"),)


class AuditLog(UUIDPk, Timestamps, Base):
    __tablename__ = "audit_logs"
    hospital_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("hospitals.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(64))
    entity_type: Mapped[str | None] = mapped_column(String(32))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict | None] = mapped_column(JSONType)
    ip_address: Mapped[str | None] = mapped_column(String(64))

    __table_args__ = (Index("ix_audit_hospital_created", "hospital_id", "created_at"),)


class SystemSetting(Timestamps, Base):
    __tablename__ = "system_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONType)
