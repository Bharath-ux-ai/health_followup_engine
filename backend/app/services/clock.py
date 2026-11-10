"""Hospital-scoped clock.

Every business time calculation (booking windows, reminder due times, "today", overdue checks) goes through
here. Real hospitals always use real time. A demo hospital (is_demo=True) on a deployment with DEMO_MODE=true
may have a frozen demo time — it only ever affects that hospital's own records.
"""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.config import get_settings
from app.models import Hospital

_test_override: datetime | None = None  # used by the test-suite only


def set_test_override(value: datetime | None) -> None:
    global _test_override
    _test_override = value


def real_now() -> datetime:
    return _test_override or datetime.now(timezone.utc)


def demo_clock_active(h: Hospital) -> bool:
    return bool(get_settings().DEMO_MODE and h.is_demo and h.demo_now is not None)


def now(h: Hospital) -> datetime:
    if demo_clock_active(h):
        return h.demo_now  # type: ignore[return-value]
    return real_now()


def tz(h: Hospital) -> ZoneInfo:
    return ZoneInfo(h.timezone)


def local_now(h: Hospital) -> datetime:
    return now(h).astimezone(tz(h))


def today(h: Hospital) -> date:
    return local_now(h).date()


def local_to_utc(h: Hospital, d: date, t: time) -> datetime:
    return datetime.combine(d, t, tzinfo=tz(h)).astimezone(timezone.utc)


def to_local(h: Hospital, dt: datetime) -> datetime:
    return dt.astimezone(tz(h))


def month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + (month == 12), (month % 12) + 1, 1) - timedelta(days=1)
    return start, end
