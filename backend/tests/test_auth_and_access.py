"""Authentication, role permissions and hospital data isolation."""
from datetime import date

from sqlalchemy import select

from app.models import PasswordResetToken, User
from tests.conftest import PASSWORD, Api, book, make_hospital


def test_login_sets_httponly_cookie_and_me_works(hospital):
    api = Api()
    r = api.post("/api/auth/login", json={"email": "ADMIN@sunrise.in", "password": PASSWORD})
    assert r.status_code == 200
    assert "httponly" in r.headers["set-cookie"].lower()
    me = api.get("/api/auth/me").json()
    assert me["role"] == "hospital_admin" and me["hospital"]["slug"] == "sunrise"
    assert "password_hash" not in me


def test_wrong_password_and_lockout(hospital):
    api = Api()
    for _ in range(5):
        assert api.post("/api/auth/login", json={"email": "staff@sunrise.in", "password": "nope-nope-1"}).status_code == 401
    r = api.post("/api/auth/login", json={"email": "staff@sunrise.in", "password": PASSWORD})
    assert r.status_code == 423  # locked after 5 failures, even with the right password


def test_unknown_email_gives_same_error(hospital):
    r = Api().post("/api/auth/login", json={"email": "ghost@sunrise.in", "password": "whatever123"})
    assert r.status_code == 401 and r.json()["detail"] == "Incorrect email or password"


def test_requires_auth_and_logout(staff):
    assert Api().get("/api/dashboard").status_code == 401
    assert staff.get("/api/dashboard").status_code == 200
    staff.post("/api/auth/logout")
    assert staff.get("/api/dashboard").status_code == 401


def test_csrf_header_required_for_cookie_writes(hospital):
    api = Api().login("staff@sunrise.in")
    del api.c.headers["X-Requested-With"]
    r = api.post("/api/followups/00000000-0000-0000-0000-000000000000/contact", json={"outcome": "reached"})
    assert r.status_code == 403 and "CSRF" in r.json()["detail"]


def test_password_reset_flow_invalidates_old_sessions(hospital, db, monkeypatch):
    sent = {}
    monkeypatch.setattr("app.services.email.send", lambda to, subject, body: sent.update(to=to, body=body) or True)
    old = Api().login("staff@sunrise.in")
    r = Api().post("/api/auth/forgot-password", json={"email": "staff@sunrise.in"})
    assert r.status_code == 200 and sent["to"] == "staff@sunrise.in"
    token = sent["body"].split("token=")[1].split()[0]
    # unknown emails get the identical response (no enumeration)
    assert Api().post("/api/auth/forgot-password", json={"email": "x@y.in"}).json() == r.json()
    assert Api().post("/api/auth/reset-password", json={"token": token, "password": "short"}).status_code == 422
    assert Api().post("/api/auth/reset-password", json={"token": token, "password": "BrandNewPass99"}).status_code == 200
    assert Api().post("/api/auth/reset-password", json={"token": token, "password": "AnotherPass99"}).status_code == 400  # single use
    assert old.get("/api/auth/me").status_code == 401  # old session revoked
    Api().login("staff@sunrise.in", "BrandNewPass99")
    assert db.scalar(select(PasswordResetToken)).token_hash != token  # only the hash is stored


def test_staff_cannot_use_admin_features(staff):
    for path in ("/api/staff", "/api/reports/monthly", "/api/whatsapp/config", "/api/whatsapp/templates", "/api/audit"):
        assert staff.get(path).status_code == 403, path
    assert staff.post("/api/doctors", json={"name": "Dr. X"}).status_code == 403
    assert staff.post("/api/demo/clock", json={"advance_days": 1}).status_code == 403


def test_system_admin_cannot_read_patient_data(sysadmin, hospital):
    assert sysadmin.get("/api/system/hospitals").status_code == 200
    for path in ("/api/appointments", "/api/patients", "/api/followups", "/api/dashboard"):
        assert sysadmin.get(path).status_code == 403, path


def test_hospital_cannot_access_platform_routes(admin):
    assert admin.get("/api/system/hospitals").status_code == 403
    assert admin.get("/api/system/status").status_code == 403


def test_hospital_data_isolation(db, hospital, admin, public):
    h1, doc1 = hospital
    h2, doc2 = make_hospital(db, slug="lotus", name="Lotus Hospital")
    other = Api().login("admin@lotus.in")
    appt = book(public, doc1, date(2026, 11, 11), "10:30").json()
    mine = admin.get("/api/appointments").json()
    assert mine["total"] == 1
    a_id = mine["items"][0]["id"]
    p_id = mine["items"][0]["patient"]["id"]
    assert other.get("/api/appointments").json()["total"] == 0
    assert other.get("/api/patients").json()["total"] == 0
    assert other.get(f"/api/appointments/{a_id}").status_code == 404
    assert other.get(f"/api/patients/{p_id}").status_code == 404
    assert other.post(f"/api/appointments/{a_id}/status", json={"status": "cancelled"}).status_code == 404
    assert other.post(f"/api/appointments/{a_id}/followup", json={"due_date": "2026-12-02"}).status_code == 404
    # a doctor from another hospital cannot be booked through this hospital's page
    r = book(public, doc2, date(2026, 11, 11), "10:30", slug="sunrise")
    assert r.status_code == 404
    assert appt["reference"].startswith("TT-")


def test_staff_management_rules(admin, db):
    r = admin.post("/api/staff", json={"full_name": "New Nurse", "email": "nurse@sunrise.in", "role": "hospital_staff", "password": "weak"})
    assert r.status_code == 422
    r = admin.post("/api/staff", json={"full_name": "New Nurse", "email": "nurse@sunrise.in", "role": "hospital_staff", "password": "GoodPass2026"})
    assert r.status_code == 201
    nurse = Api().login("nurse@sunrise.in", "GoodPass2026")
    uid = r.json()["id"]
    assert admin.patch(f"/api/staff/{uid}", json={"is_active": False}).status_code == 200
    assert nurse.get("/api/dashboard").status_code == 401  # deactivation signs out immediately
    me = admin.get("/api/auth/me").json()
    r = admin.patch(f"/api/staff/{me['id']}", json={"role": "hospital_staff"})
    assert r.status_code == 422 and "at least one active admin" in r.json()["detail"]
    assert db.scalar(select(User).where(User.email == "nurse@sunrise.in")).is_active is False


def test_suspended_hospital_blocks_login(sysadmin, hospital, staff):
    h, _ = hospital
    assert sysadmin.patch(f"/api/system/hospitals/{h.id}", json={"is_active": False}).status_code == 200
    assert staff.get("/api/dashboard").status_code == 403
    r = Api().post("/api/auth/login", json={"email": "staff@sunrise.in", "password": PASSWORD})
    assert r.status_code == 403
