import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, MetaData, TypeDecorator, Uuid, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class UTCDateTime(TypeDecorator):
    """Timezone-aware datetime stored in UTC; SQLite returns naive values, so normalise on read."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None:
            if value.tzinfo is None:
                raise ValueError("naive datetime given to UTCDateTime")
            value = value.astimezone(timezone.utc)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UUIDPk:
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, server_default=func.now(), nullable=False
    )


class SoftDelete:
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
