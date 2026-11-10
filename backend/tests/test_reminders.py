"""Appointment reminders, follow-up reminders (7-day / 3-day), date boundaries and duplicate prevention."""
from datetime import date, datetime, timezone

from sqlalchemy import select

from app.models import FollowUp, Patient, ReminderSchedule, WhatsAppMessage
from app.models.enums import ReminderKind, ReminderStatus
from tests.conftest import at, book, ist, run_worker

WED = date(2026, 11, 11)


def reminders(db, kind=None):
    db.expire_all()
    q = select(ReminderSchedule).order_by(ReminderSchedule.scheduled_for)
    if kind:
        q = q.where(ReminderSchedule.kind == kind)
    return list(db.scalars(q))


def test_appointment_reminder_is_day_before_at_send_time(hospital, public, db):
    h, doc = hospital
    book(public, doc, WED, "10:30")
    [r] = reminders(db)
    assert r.kind == ReminderKind.appointment_1d and r.status == ReminderStatus.pending
    assert r.scheduled_for == ist(2026, 11, 10, 18, 0).astimezone(timezone.utc)  # Tuesday 18:00 IST = 12:30 UTC


def test_reminder_not_sent_early_and_sent_exactly_once(hospital, public, db):
    h, doc = hospital
    book(public, doc, WED, "10:30")
    at(ist(2026, 11, 10, 17, 59))
    run_worker(db)
    assert reminders(db)[0].status == ReminderStatus.pending
    at(ist(2026, 11, 10, 18, 0))
    run_worker(db)
    run_worker(db)  # second cycle must not duplicate
    [r] = reminders(db)
    assert r.status == ReminderStatus.sent
    msgs = db.scalars(select(WhatsAppMessage)).all()
    assert len(msgs) == 1
    assert msgs[0].status.value == "simulated" and msgs[0].is_simulated  # simulation mode: never claims "sent"
    assert "Your appointment with Dr. Arun Kumar is scheduled for tomorrow, Wed, 11 Nov at 10:30 AM" in msgs[0].body
    assert [b["action"] for b in msgs[0].buttons] == ["CONFIRM", "RESCHEDULE"]


def test_tamil_template_used_for_tamil_patient(hospital, public, db):
    h, doc = hospital
    book(public, doc, WED, "10:30", lang="ta")
    at(ist(2026, 11, 10, 18, 1))
    run_worker(db)
    msg = db.scalar(select(WhatsAppMessage))
    assert msg.language == "ta" and "வணக்கம் Ravi" in msg.body and "புதன், 11 நவம்பர்" in msg.body
    assert msg.buttons[0]["label"] == "உறுதிசெய்"


def test_same_day_booking_skips_reminder(hospital, public, db):
    h, doc = hospital
    book(public, doc, date(2026, 11, 9), "12:00")
    [r] = reminders(db)
    assert r.status == ReminderStatus.skipped and "Same-day" in r.skip_reason


def test_late_booking_gets_catch_up_reminder_respecting_quiet_hours(hospital, public, db):
    h, doc = hospital
    at(ist(2026, 11, 10, 19, 30))  # after Tuesday's 18:00 send time, for Wednesday
    book(public, doc, WED, "10:30")
    assert reminders(db)[0].scheduled_for == ist(2026, 11, 10, 19, 30).astimezone(timezone.utc)
    at(ist(2026, 11, 10, 22, 15))  # inside quiet hours → deferred to 08:00 next morning (still before the 10:30 visit)
    book(public, doc, WED, "11:00", name="Lakshmi", phone="9894022222")
    late = [r for r in reminders(db) if r.scheduled_for != ist(2026, 11, 10, 19, 30).astimezone(timezone.utc)][0]
    assert late.scheduled_for == ist(2026, 11, 11, 8, 0).astimezone(timezone.utc)


def test_no_consent_means_no_message(hospital, public, db):
    h, doc = hospital
    book(public, doc, WED, "10:30", consent=False)
    at(ist(2026, 11, 10, 18, 5))
    run_worker(db)
    [r] = reminders(db)
    assert r.status == ReminderStatus.skipped and r.skip_reason == "No WhatsApp consent recorded"
    assert db.scalar(select(WhatsAppMessage)) is None


def test_reschedule_moves_reminder_and_never_resends(hospital, public, staff, db):
    h, doc = hospital
    book(public, doc, WED, "10:30")
    a = staff.get("/api/appointments").json()["items"][0]
    staff.post(f"/api/appointments/{a['id']}/reschedule", json={"date": "2026-11-13", "start_time": "10:30"})
    rs = reminders(db)
    assert [(r.target_date.isoformat(), r.status.value) for r in rs] == [("2026-11-11", "cancelled"), ("2026-11-13", "pending")]
    at(ist(2026, 11, 12, 18, 5))
    run_worker(db)
    # move back to Friday's original slot after it was sent → the already-sent key is not reused for a new message
    staff.post(f"/api/appointments/{a['id']}/reschedule", json={"date": "2026-11-14", "start_time": "10:30"})
    staff.post(f"/api/appointments/{a['id']}/reschedule", json={"date": "2026-11-13", "start_time": "10:45"})
    at(ist(2026, 11, 13, 9, 0))
    run_worker(db)
    assert db.query(WhatsAppMessage).count() == 1


def test_cancelled_appointment_reminder_not_sent(hospital, public, staff, db):
    h, doc = hospital
    book(public, doc, WED, "10:30")
    a = staff.get("/api/appointments").json()["items"][0]
    staff.post(f"/api/appointments/{a['id']}/status", json={"status": "cancelled"})
    at(ist(2026, 11, 10, 18, 5))
    run_worker(db)
    assert reminders(db)[0].status == ReminderStatus.cancelled and db.scalar(select(WhatsAppMessage)) is None


# ---- follow-ups ----------------------------------------------------------------------------------------------
def _visit_and_followup(public, staff, doc, due="2026-12-02"):
    book(public, doc, WED, "10:30")
    a = staff.get("/api/appointments").json()["items"][0]
    at(ist(2026, 11, 11, 10, 45))
    staff.post(f"/api/appointments/{a['id']}/status", json={"status": "completed"})
    return a, staff.post(f"/api/appointments/{a['id']}/followup", json={"due_date": due})


def test_followup_creates_7_and_3_day_reminders(hospital, public, staff, db):
    h, doc = hospital
    a, r = _visit_and_followup(public, staff, doc)
    assert r.status_code == 201, r.text
    fr = reminders(db, ReminderKind.followup_7d) + reminders(db, ReminderKind.followup_3d)
    assert [(x.kind.value, x.scheduled_for) for x in fr] == [
        ("followup_7d", ist(2026, 11, 25, 18, 0).astimezone(timezone.utc)),
        ("followup_3d", ist(2026, 11, 29, 18, 0).astimezone(timezone.utc)),
    ]
    # the scenario timeline from the brief: reminders on 25 and 29 November
    at(ist(2026, 11, 25, 18, 2))
    run_worker(db)
    at(ist(2026, 11, 29, 18, 2))
    run_worker(db)
    msgs = db.scalars(select(WhatsAppMessage).where(WhatsAppMessage.followup_id.is_not(None)).order_by(WhatsAppMessage.occurred_at)).all()
    assert len(msgs) == 2
    assert "due on Wed, 2 Dec, 7 days from today" in msgs[0].body and "3 days from today" in msgs[1].body


def test_followup_validation_and_no_duplicates(hospital, public, staff, db):
    h, doc = hospital
    a, r = _visit_and_followup(public, staff, doc)
    dup = staff.post(f"/api/appointments/{a['id']}/followup", json={"due_date": "2026-12-05"})
    assert dup.status_code == 409 and dup.json()["code"] == "followup_exists"
    book(public, doc, date(2026, 11, 12), "10:30", name="Lakshmi", phone="9894022222")
    b = staff.get("/api/appointments?q=Lakshmi").json()["items"][0]
    assert staff.post(f"/api/appointments/{b['id']}/followup", json={"due_date": "2026-11-11"}).status_code == 422  # not in future


def test_short_notice_followup_boundaries(hospital, public, staff, db):
    h, doc = hospital
    # follow-up 5 days away: the 7-day reminder time already passed → skipped, 3-day stays
    a, r = _visit_and_followup(public, staff, doc, due="2026-11-16")
    rs = {x.kind: x for x in reminders(db) if x.followup_id}
    assert rs[ReminderKind.followup_7d].status == ReminderStatus.skipped
    assert rs[ReminderKind.followup_3d].status == ReminderStatus.pending
    assert rs[ReminderKind.followup_3d].scheduled_for == ist(2026, 11, 13, 18, 0).astimezone(timezone.utc)


def test_two_day_followup_gets_single_catch_up(hospital, public, staff, db):
    h, doc = hospital
    a, r = _visit_and_followup(public, staff, doc, due="2026-11-13")
    rs = {x.kind: x for x in reminders(db) if x.followup_id}
    assert rs[ReminderKind.followup_7d].status == ReminderStatus.skipped
    assert rs[ReminderKind.followup_3d].status == ReminderStatus.pending
    assert rs[ReminderKind.followup_3d].scheduled_for == ist(2026, 11, 11, 10, 45).astimezone(timezone.utc)  # right away


def test_changing_followup_date_reschedules_reminders(hospital, public, staff, db):
    h, doc = hospital
    a, r = _visit_and_followup(public, staff, doc)
    fid = r.json()["id"]
    assert staff.patch(f"/api/followups/{fid}", json={"due_date": "2026-12-09"}).status_code == 200
    pend = [x for x in reminders(db) if x.followup_id and x.status == ReminderStatus.pending]
    assert sorted(x.target_date.isoformat() for x in pend) == ["2026-12-09", "2026-12-09"]
    assert len([x for x in reminders(db) if x.followup_id and x.status == ReminderStatus.cancelled]) == 2


def test_unconfirmed_turns_red_then_overdue_becomes_missed(hospital, public, staff, db):
    h, doc = hospital
    a, r = _visit_and_followup(public, staff, doc)
    fid = r.json()["id"]
    for when in (ist(2026, 11, 25, 18, 2), ist(2026, 11, 29, 18, 2)):
        at(when)
        run_worker(db)
    assert staff.get(f"/api/followups/{fid}").json()["attention"] is None  # 3 days out: not yet red
    at(ist(2026, 11, 30, 10, 0))
    fu = staff.get(f"/api/followups/{fid}").json()
    assert fu["attention"] == "unconfirmed" and fu["status"] == "scheduled"  # red, but NOT marked missed
    dash = staff.get("/api/dashboard").json()
    assert [x["id"] for x in dash["followups"]["attention"]] == [fid]
    at(ist(2026, 12, 3, 9, 0))
    run_worker(db)
    fu = staff.get(f"/api/followups/{fid}").json()
    assert fu["status"] == "missed" and fu["attention"] == "overdue"
    r = staff.post(f"/api/followups/{fid}/contact", json={"outcome": "will_visit", "note": "Coming Friday"})
    assert r.status_code == 201 and r.json()["contact_count"] == 1 and r.json()["contacts"][0]["outcome"] == "will_visit"
    # staff books the visit after the call → follow-up leaves the red list
    staff.post(f"/api/followups/{fid}/book", json={"date": "2026-12-04", "start_time": "10:30"})
    assert staff.get(f"/api/followups/{fid}").json()["status"] == "rescheduled"
    assert staff.get(f"/api/followups/{fid}").json()["attention"] is None


def test_returning_visit_completes_followup(hospital, public, staff, db):
    h, doc = hospital
    a, r = _visit_and_followup(public, staff, doc)
    fid = r.json()["id"]
    at(ist(2026, 11, 30, 9, 0))
    book(public, doc, date(2026, 12, 2), "10:30")  # patient books again on their own via the link
    at(ist(2026, 12, 2, 11, 0))
    b = staff.get("/api/appointments?date_from=2026-12-02").json()["items"][0]
    staff.post(f"/api/appointments/{b['id']}/status", json={"status": "completed"})
    assert staff.get(f"/api/followups/{fid}").json()["status"] == "completed"


def test_withdrawn_consent_cancels_pending(hospital, public, staff, db):
    h, doc = hospital
    a, r = _visit_and_followup(public, staff, doc)
    pid = db.scalar(select(Patient)).id
    staff.patch(f"/api/patients/{pid}", json={"whatsapp_consent": False})
    assert all(x.status != ReminderStatus.pending for x in reminders(db))
    assert db.scalar(select(FollowUp)).status.value == "scheduled"
