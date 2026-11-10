"""Test harness: real PostgreSQL (or SQLite via TEST_DATABASE_URL), migrations applied, tables truncated per test."""
import os
import secrets
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet

os.environ.update({
    "ENVIRONMENT": "test",
    "DATABASE_URL": os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://tectha:tectha_dev@localhost:5432/tectha_test"),
    "SECRET_KEY": secrets.token_urlsafe(48),
    "ENCRYPTION_KEY": Fernet.generate_key().decode(),
    "COOKIE_SECURE": "false",
    "DEMO_MODE": "true",
    "DEMO_PASSWORD": "DemoPass2026",
    "WHATSAPP_VERIFY_TOKEN": "verify-me",
    "META_APP_SECRET": "platform-secret",
    "PUBLIC_APP_URL": "http://localhost:3000",
    "RUN_WORKER_IN_API": "false",
})

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core import ratelimit  # noqa: E402
from app.core.permissions import HOSPITAL_ADMIN, HOSPITAL_STAFF, SYSTEM_ADMIN  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Doctor, DoctorAvailability, Hospital  # noqa: E402
from app.services import clock, onboarding  # noqa: E402
from app.services.whatsapp import outbound  # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
PASSWORD = "StrongPass123"


def ist(y, m, d, hh=9, mm=0) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=IST)


@pytest.fixture(scope="session", autouse=True)
def _schema():
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    with engine.begin() as conn:
        Base.metadata.drop_all(conn)
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    command.upgrade(cfg, "head")  # the migrations themselves are under test
    yield


@pytest.fixture(autouse=True)
def _clean():
    tables = [t.name for t in reversed(Base.metadata.sorted_tables) if t.name not in ("roles", "permissions", "role_permissions")]
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(text(f"TRUNCATE {', '.join(tables)} CASCADE"))
        else:
            for t in tables:
                conn.execute(text(f"DELETE FROM {t}"))
    ratelimit.login_limiter.reset()
    ratelimit.booking_limiter.reset()
    ratelimit.forgot_limiter.reset()
    clock.set_test_override(ist(2026, 11, 9, 9, 0))  # Monday 9 Nov 2026, 09:00 IST
    outbound.transport_override = None
    yield
    clock.set_test_override(None)
    outbound.transport_override = None


@pytest.fixture
def db():
    s = SessionLocal()
    yield s
    s.close()


def at(dt: datetime) -> None:
    clock.set_test_override(dt)


def make_hospital(db, slug="sunrise", name="Sunrise Clinic", *, is_demo=False, admin_email=None, staff_email=None):
    onboarding.ensure_roles(db)
    h, admin = onboarding.create_hospital(db, name=name, slug=slug, admin_name="Admin", is_demo=is_demo,
                                          admin_email=admin_email or f"admin@{slug}.in", admin_password=PASSWORD)
    onboarding.create_user(db, email=staff_email or f"staff@{slug}.in", full_name="Reception", password=PASSWORD,
                           role_code=HOSPITAL_STAFF, hospital=h)
    doc = Doctor(hospital_id=h.id, name="Dr. Arun Kumar", specialty="General Physician")
    doc.availability = [DoctorAvailability(hospital_id=h.id, weekday=wd, start_time=time(9), end_time=time(13)) for wd in range(6)]
    db.add(doc)
    db.commit()
    return h, doc


class Api:
    """TestClient that sends the CSRF header and remembers its own session cookie."""

    def __init__(self):
        self.c = TestClient(app)
        self.c.headers.update({"X-Requested-With": "tectha"})

    def login(self, email, password=PASSWORD):
        r = self.c.post("/api/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        return self

    def __getattr__(self, name):
        return getattr(self.c, name)


@pytest.fixture
def hospital(db):
    return make_hospital(db)


@pytest.fixture
def admin(hospital):
    return Api().login("admin@sunrise.in")


@pytest.fixture
def staff(hospital):
    return Api().login("staff@sunrise.in")


@pytest.fixture
def public():
    return Api()


@pytest.fixture
def sysadmin(db):
    onboarding.ensure_roles(db)
    onboarding.create_user(db, email="ops@tectha.in", full_name="Ops", password=PASSWORD, role_code=SYSTEM_ADMIN, hospital=None)
    db.commit()
    return Api().login("ops@tectha.in")


def book(public_api, doc, d: date, t: str, name="Ravi", phone="9894011111", consent=True, lang="en", slug="sunrise"):
    return public_api.post(f"/api/public/hospitals/{slug}/appointments", json={
        "full_name": name, "phone": phone, "language": lang, "whatsapp_consent": consent,
        "doctor_id": str(doc.id), "date": d.isoformat(), "start_time": t,
    })


def run_worker(db, h_id=None):
    from app.services import dispatcher
    h = db.get(Hospital, h_id) if h_id else None
    db.expire_all()
    return dispatcher.run_cycle(db, h)
