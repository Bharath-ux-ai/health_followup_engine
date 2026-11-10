"""Monthly report calculations / CSV export, demo controls and the full Mr. Ravi scenario."""
from datetime import date

from sqlalchemy import select

from app.models import Hospital, WhatsAppMessage
from app.models.enums import MessageStatus
from tests.conftest import PASSWORD, Api, at, book, ist, make_hospital, run_worker


def _followup_journey(staff, public, doc, db, *, name, phone, slot, reminded: bool):
    at(ist(2026, 11, 9, 9, 0))  # each journey books on Monday for Wednesday
    book(public, doc, date(2026, 11, 11), slot, name=name, phone=phone, consent=reminded)
    a = staff.get(f"/api/appointments?q={phone[-5:]}").json()["items"][0]
    at(ist(2026, 11, 11, 13, 30))
    staff.post(f"/api/appointments/{a['id']}/status", json={"status": "completed"})
    fid = staff.post(f"/api/appointments/{a['id']}/followup", json={"due_date": "2026-11-25"}).json()["id"]
    return a, fid


def test_brought_back_counts_only_returns_after_a_reminder(hospital, public, staff, admin, db):
    h, doc = hospital
    h.is_demo = True  # simulated reminders count for demo hospitals only (see next test for real hospitals)
    db.commit()
    _, f1 = _followup_journey(staff, public, doc, db, name="Ravi", phone="9894011111", slot="10:30", reminded=True)
    _, f2 = _followup_journey(staff, public, doc, db, name="Anitha", phone="9894022222", slot="11:00", reminded=False)
    _, f3 = _followup_journey(staff, public, doc, db, name="Meena", phone="9894033333", slot="11:30", reminded=True)
    at(ist(2026, 11, 18, 18, 5))  # 7-day reminders (Anitha has no consent → none)
    run_worker(db)
    at(ist(2026, 11, 25, 9, 0))
    for fid in (f1, f2):  # Ravi and Anitha return; Meena does not
        assert staff.post(f"/api/followups/{fid}/status", json={"status": "completed"}).status_code == 200
    rep = admin.get("/api/reports/monthly?year=2026&month=11").json()
    assert rep["retention"]["brought_back"] == 1  # Ravi only — Anitha returned without any reminder
    assert rep["retention"]["returned_without_reminder"] == 1
    assert rep["summary"] == "We brought back 1 patient this month."
    assert rep["appointments"]["total"] == 3 and rep["appointments"]["completed"] == 3
    assert rep["followups"]["scheduled"] == 3 and rep["followups"]["completed"] == 2
    at(ist(2026, 11, 27, 9, 0))
    run_worker(db)  # Meena's follow-up is now overdue
    rep = admin.get("/api/reports/monthly?year=2026&month=11").json()
    assert rep["followups"]["missed"] == 1 and rep["followups"]["return_rate"] == 66.7
    assert rep["reminders"]["simulated"] == 2 and rep["reminders"]["sent"] == 0
    assert len(rep["trend"]) == 6 and rep["trend"][-1]["label"] == "Nov 2026"


def test_simulated_reminders_are_not_counted_for_real_hospitals(hospital, public, staff, admin, db):
    """Sunrise is a real (non-demo) hospital in simulation mode: simulated messages never reached the patient."""
    h, doc = hospital
    _, f1 = _followup_journey(staff, public, doc, db, name="Ravi", phone="9894011111", slot="10:30", reminded=True)
    at(ist(2026, 11, 18, 18, 5))
    run_worker(db)
    assert db.scalar(select(WhatsAppMessage)).status == MessageStatus.simulated
    at(ist(2026, 11, 25, 9, 0))
    staff.post(f"/api/followups/{f1}/status", json={"status": "completed"})
    rep = admin.get("/api/reports/monthly?year=2026&month=11").json()
    assert rep["retention"]["brought_back"] == 0 and rep["retention"]["returned_without_reminder"] == 1


def test_csv_export_and_snapshot(hospital, public, admin):
    h, doc = hospital
    book(public, doc, date(2026, 11, 11), "10:30")
    r = admin.get("/api/reports/monthly.csv?year=2026&month=11")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="tectha-report-sunrise-2026-11.csv"' in r.headers["content-disposition"]
    text = r.content.decode("utf-8-sig")
    assert "We brought back 0 patients this month." in text and "2026-11-11,1,0,0,0" in text
    assert admin.post("/api/reports/monthly/snapshot?year=2026&month=11").status_code == 200
    assert admin.get("/api/reports/snapshots").json()[0]["month"] == 11


# ---- demo -------------------------------------------------------------------------------------------------------
def test_demo_controls_refused_for_real_hospital(admin):
    assert admin.post("/api/demo/clock", json={"advance_days": 1}).status_code == 403
    assert admin.post("/api/demo/reset", json={}).status_code == 403


def _demo(db):
    from app.services import demo, onboarding
    onboarding.ensure_roles(db)
    h = demo.ensure_demo_hospital(db)
    db.commit()
    return h


def test_demo_clock_is_isolated_to_demo_hospital(db, hospital, staff):
    h_demo = _demo(db)
    api = Api().login("admin@tectha-demo.in", "DemoPass2026")
    out = api.post("/api/demo/clock", json={"set_to": "2026-11-25T18:05"}).json()
    assert out["now"].startswith("2026-11-25T18:05")
    assert staff.get("/api/dashboard").json()["today"] == "2026-11-09"  # real hospital unaffected
    assert api.post("/api/demo/clock", json={"advance_days": 7}).json()["now"].startswith("2026-12-02T18:05")
    assert api.post("/api/demo/clock", json={"reset_to_real": True}).json()["demo_clock"] is False


def test_demo_reset_loads_sample_journeys(db):
    _demo(db)
    api = Api().login("admin@tectha-demo.in", "DemoPass2026")
    res = api.post("/api/demo/reset", json={"with_samples": True}).json()
    assert res["result"] == {"patients": 12, "appointments": 14}
    assert res["now"].startswith("2026-11-09T09:00")
    dash = api.get("/api/dashboard").json()
    red = sorted((f["patient"]["full_name"], f["attention"]) for f in dash["followups"]["attention"])
    assert red == [("Karthikeyan Ramasamy", "unconfirmed"), ("Meena Sundaram", "overdue"), ("Murugan Selvaraj", "overdue")]
    assert dash["day"]["counts"]["confirmed"] == 1 and dash["day"]["counts"]["booked"] == 1
    rep = api.get("/api/reports/monthly?year=2026&month=10").json()
    assert rep["retention"]["brought_back"] == 1 and rep["includes_simulated_messages"] is True
    # resetting twice gives the same state (repeatable demos)
    again = api.post("/api/demo/reset", json={"with_samples": True}).json()
    assert again["result"] == res["result"]
    assert api.get("/api/patients").json()["total"] == 12
    assert all(p["is_demo"] for p in api.get("/api/patients").json()["items"])


def test_mr_ravi_scenario_end_to_end(db):
    """The brief's demo script, driven entirely through the API with the demo clock."""
    _demo(db)
    admin = Api().login("admin@tectha-demo.in", "DemoPass2026")
    patient = Api()
    admin.post("/api/demo/reset", json={"with_samples": False})
    clock = lambda s: admin.post("/api/demo/clock", json={"set_to": s}).json()  # noqa: E731
    run = lambda: admin.post("/api/demo/run-reminders").json()  # noqa: E731

    # 1. Monday: Mr. Ravi books Dr. Arun Kumar, Wednesday 10:30 on the public link
    clock("2026-11-09T10:00")
    page = patient.get("/api/public/hospitals/tectha-clinic").json()
    arun = next(d for d in page["doctors"] if d["name"] == "Dr. Arun Kumar")
    slots = patient.get(f"/api/public/hospitals/tectha-clinic/slots?doctor_id={arun['id']}&date=2026-11-11").json()["slots"]
    assert {"start_time": "10:30", "end_time": "10:45", "available": True} in slots
    r = patient.post("/api/public/hospitals/tectha-clinic/appointments", json={
        "full_name": "Ravi", "phone": "9894099999", "doctor_id": arun["id"], "date": "2026-11-11", "start_time": "10:30",
        "whatsapp_consent": True})
    assert r.status_code == 201
    state = admin.get("/api/demo/state").json()["scenario"]
    assert state["appointment"]["status"] == "booked"

    # 2. Tuesday evening: reminder → Confirm
    clock("2026-11-10T18:05")
    assert run()["totals"]["simulated"] == 1
    pid = state["patient_id"]
    msg = [m for m in admin.get(f"/api/messages/conversations/{pid}").json()["messages"] if m["answerable"]][0]
    assert "Hello Ravi" in msg["body"] and "TEC THA Multispeciality Clinic" in msg["body"] and "10:30 AM" in msg["body"]
    admin.post("/api/messages/simulate-tap", json={"message_id": msg["id"], "action": "CONFIRM"})
    assert admin.get("/api/demo/state").json()["scenario"]["appointment"]["status"] == "confirmed"

    # 3. Wednesday: visit completed. 4. Follow-up for 2 December
    clock("2026-11-11T10:45")
    aid = state["appointment"]["id"]
    assert admin.post(f"/api/appointments/{aid}/status", json={"status": "completed"}).json()["status"] == "completed"
    fid = admin.post(f"/api/appointments/{aid}/followup", json={"due_date": "2026-12-02"}).json()["id"]
    fu = admin.get(f"/api/followups/{fid}").json()
    assert [(x["kind"], x["scheduled_for"][:10]) for x in fu["reminders"]] == [("followup_7d", "2026-11-25"), ("followup_3d", "2026-11-29")]

    # 5 & 6. Reminders on 25 and 29 November
    clock("2026-11-25T18:05")
    assert run()["totals"]["simulated"] == 1
    clock("2026-11-29T18:05")
    assert run()["totals"]["simulated"] == 1

    # 8. No response → red on the dashboard (unconfirmed, not "missed")
    admin.post(f"/api/demo/followups/{fid}/no-response")
    dash = admin.get("/api/dashboard").json()
    assert [(f["patient"]["full_name"], f["attention"]) for f in dash["followups"]["attention"]] == [("Ravi", "unconfirmed")]

    # 7. Patient taps Reschedule on the 3-day reminder and picks 4 December via the link
    msgs = admin.get(f"/api/messages/conversations/{pid}").json()["messages"]
    three = [m for m in msgs if m["answerable"]][-1]
    res = admin.post("/api/messages/simulate-tap", json={"message_id": three["id"], "action": "RESCHEDULE"}).json()
    token = res["action_url"].split("/r/")[1]
    assert patient.post(f"/api/public/actions/{token}/reschedule", json={"date": "2026-12-04", "start_time": "11:00"}).status_code == 200
    fu = admin.get(f"/api/followups/{fid}").json()
    assert fu["status"] == "rescheduled" and fu["due_date"] == "2026-12-04" and fu["attention"] is None

    # Visit happens → counted as brought back in the December report
    clock("2026-12-04T11:20")
    admin.post(f"/api/appointments/{fu['visit']['id']}/status", json={"status": "completed"})
    assert admin.get(f"/api/followups/{fid}").json()["status"] == "completed"
    assert admin.get("/api/reports/monthly?year=2026&month=12").json()["summary"] == "We brought back 1 patient this month."


def test_system_admin_onboards_hospital(sysadmin, db):
    r = sysadmin.post("/api/system/hospitals", json={"name": "Kovai Care", "slug": "kovai-care", "city": "Coimbatore",
                                                     "admin_name": "Dr. Selvi", "admin_email": "selvi@kovai.in", "admin_password": "KovaiCare2026"})
    assert r.status_code == 201, r.text
    assert sysadmin.post("/api/system/hospitals", json={"name": "Dup", "slug": "kovai-care", "admin_name": "Xavier",
                                                        "admin_email": "x@kovai.in", "admin_password": "KovaiCare2026"}).status_code == 409
    a = Api().login("selvi@kovai.in", "KovaiCare2026")
    assert len(a.get("/api/whatsapp/templates").json()["items"]) == 14  # EN + TA defaults seeded
    assert a.get("/api/whatsapp/config").json()["mode"] == "simulation"
    st = sysadmin.get("/api/system/status").json()
    assert st["database"] == "ok" and st["hospitals"]["total"] == 1
