"""WhatsApp Cloud API adapter, retries/failures, webhooks (signature, statuses, button replies) and the simulator."""
import hashlib
import hmac
import json
from datetime import date

import httpx
import pytest
from sqlalchemy import select

from app.models import Appointment, FollowUp, Patient, ReminderSchedule, WhatsAppMessage
from app.models.enums import MessageDirection, ReminderKind, ReminderStatus
from app.services.whatsapp import outbound
from tests.conftest import Api, at, book, ist, run_worker

WED = date(2026, 11, 11)
PHONE_ID = "1029384756"


class FakeMeta:
    """Stands in for graph.facebook.com so the real CloudApiProvider code path runs end to end."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.responses: list = []  # queue of (status, json) or exceptions
        self.n = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.responses:
            nxt = self.responses.pop(0)
            if isinstance(nxt, Exception):
                raise nxt
            return httpx.Response(nxt[0], json=nxt[1])
        if request.method == "GET":
            return httpx.Response(200, json={"display_phone_number": "+91 422 400 0000", "verified_name": "Sunrise Clinic", "id": PHONE_ID})
        self.n += 1
        return httpx.Response(200, json={"messaging_product": "whatsapp", "messages": [{"id": f"wamid.TEST{self.n}"}]})

    def bodies(self):
        return [json.loads(r.content) for r in self.requests if r.method == "POST"]


@pytest.fixture
def meta():
    fake = FakeMeta()
    outbound.transport_override = httpx.MockTransport(fake.handler)
    return fake


@pytest.fixture
def live(admin, meta):
    r = admin.put("/api/whatsapp/config", json={"phone_number_id": PHONE_ID, "waba_id": "555", "access_token": "EAAG-secret-token", "mode": "live"})
    assert r.status_code == 200, r.text
    assert "EAAG-secret-token" not in r.text and r.json()["access_token_hint"].endswith("oken")
    return meta


def signed(payload: dict, secret="platform-secret"):
    raw = json.dumps(payload).encode()
    return raw, {"X-Hub-Signature-256": "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest(),
                 "Content-Type": "application/json"}


def webhook(value: dict) -> dict:
    return {"object": "whatsapp_business_account", "entry": [{"id": "555", "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp", "metadata": {"display_phone_number": "914224000000", "phone_number_id": PHONE_ID}, **value}}]}]}


def send_reminder_live(public, doc, db, name="Ravi", phone="9894011111"):
    book(public, doc, WED, "10:30", name=name, phone=phone)
    at(ist(2026, 11, 10, 18, 5))
    run_worker(db)
    db.expire_all()
    return db.scalar(select(ReminderSchedule).where(ReminderSchedule.kind == ReminderKind.appointment_1d))


def test_live_send_uses_cloud_api_template(hospital, public, live, db):
    h, doc = hospital
    r = send_reminder_live(public, doc, db)
    assert r.status == ReminderStatus.sent
    req = live.requests[0]
    assert req.url.path == f"/v23.0/{PHONE_ID}/messages" and req.headers["authorization"] == "Bearer EAAG-secret-token"
    body = json.loads(req.content)
    assert body["to"] == "919894011111" and body["type"] == "template"
    assert body["template"]["name"] == "appointment_reminder_v1" and body["template"]["language"]["code"] == "en"
    params = [p["text"] for p in body["template"]["components"][0]["parameters"]]
    assert params == ["Ravi", "Sunrise Clinic", "Dr. Arun Kumar", "Wed, 11 Nov", "10:30 AM"]
    assert body["template"]["components"][1]["parameters"][0]["payload"] == f"TT1|CONFIRM|{r.id}"
    msg = db.get(WhatsAppMessage, r.message_id)
    assert msg.status.value == "sent" and msg.wamid == "wamid.TEST1" and not msg.is_simulated


def test_transient_failure_retries_with_backoff(hospital, public, live, db):
    h, doc = hospital
    live.responses = [(500, {"error": {"message": "Service unavailable", "code": 131016}})]
    r = send_reminder_live(public, doc, db)
    assert r.status == ReminderStatus.pending and r.attempts == 1 and "131016" in r.last_error
    at(ist(2026, 11, 10, 18, 9))
    run_worker(db)
    db.expire_all()
    assert db.get(ReminderSchedule, r.id).status == ReminderStatus.pending  # backoff not over yet
    at(ist(2026, 11, 10, 18, 11))
    run_worker(db)
    db.expire_all()
    assert db.get(ReminderSchedule, r.id).status == ReminderStatus.sent
    statuses = sorted(m.status.value for m in db.scalars(select(WhatsAppMessage)))
    assert statuses == ["failed", "sent"]


def test_permanent_failure_is_tracked_and_can_be_retried(hospital, public, live, admin, db):
    h, doc = hospital
    live.responses = [(400, {"error": {"message": "Message undeliverable", "code": 131026,
                                       "error_data": {"details": "Recipient is not a WhatsApp user"}}})]
    r = send_reminder_live(public, doc, db)
    assert r.status == ReminderStatus.failed and r.attempts == 1 and "not a WhatsApp user" in r.last_error
    failed = admin.get("/api/messages/reminders/failed").json()
    assert len(failed) == 1 and failed[0]["patient"]["full_name"] == "Ravi"
    out = admin.post(f"/api/messages/reminders/{r.id}/retry", json={})
    assert out.status_code == 200 and out.json()["status"] == "sent"


def test_timeout_marks_delivery_uncertain_and_requires_confirmation(hospital, public, live, admin, db):
    h, doc = hospital
    live.responses = [httpx.ReadTimeout("read timed out")]
    r = send_reminder_live(public, doc, db)
    assert r.status == ReminderStatus.failed and r.delivery_uncertain
    res = admin.post(f"/api/messages/reminders/{r.id}/retry", json={})
    assert res.status_code == 422 and res.json()["code"] == "uncertain"
    assert admin.post(f"/api/messages/reminders/{r.id}/retry", json={"confirm_uncertain": True}).json()["status"] == "sent"


def test_live_mode_requires_credentials(admin):
    r = admin.put("/api/whatsapp/config", json={"mode": "live"})
    assert r.status_code == 422


def test_verify_credentials_calls_cloud_api(admin, live):
    out = admin.post("/api/whatsapp/config/verify").json()
    assert out["verified_name"] == "Sunrise Clinic" and out["last_verified_at"]


def test_demo_patients_are_never_messaged_for_real(hospital, public, live, db):
    h, doc = hospital
    book(public, doc, WED, "10:30")
    p = db.scalar(select(Patient))
    p.is_demo = True
    db.commit()
    at(ist(2026, 11, 10, 18, 5))
    run_worker(db)
    assert live.requests == []
    assert db.scalar(select(WhatsAppMessage)).status.value == "simulated"


# ---- webhooks ---------------------------------------------------------------------------------------------------
def test_webhook_verification_handshake():
    api = Api()
    ok = api.get("/api/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1158201444"})
    assert ok.status_code == 200 and ok.text == "1158201444"
    bad = api.get("/api/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "x"})
    assert bad.status_code == 403


def test_webhook_rejects_bad_signature(hospital, live):
    raw, headers = signed(webhook({"statuses": []}), secret="attacker")
    assert Api().post("/api/webhooks/whatsapp", content=raw, headers=headers).status_code == 401


def test_webhook_delivery_statuses_never_downgrade(hospital, public, live, db):
    h, doc = hospital
    r = send_reminder_live(public, doc, db)
    for st in ("read", "delivered"):  # out of order on purpose
        raw, headers = signed(webhook({"statuses": [{"id": "wamid.TEST1", "status": st, "timestamp": "1762788000", "recipient_id": "919894011111"}]}))
        assert Api().post("/api/webhooks/whatsapp", content=raw, headers=headers).status_code == 200
    db.expire_all()
    msg = db.get(WhatsAppMessage, r.message_id)
    assert msg.status.value == "read" and msg.read_at and msg.delivered_at
    assert [log.status for log in msg.delivery_logs] == ["sent", "read", "delivered"]


def test_webhook_failed_status_marks_reminder_failed(hospital, public, live, db):
    h, doc = hospital
    r = send_reminder_live(public, doc, db)
    raw, headers = signed(webhook({"statuses": [{"id": "wamid.TEST1", "status": "failed", "timestamp": "1762788000",
                                                  "errors": [{"code": 131049, "title": "Not delivered to maintain ecosystem health"}]}]}))
    Api().post("/api/webhooks/whatsapp", content=raw, headers=headers)
    db.expire_all()
    assert db.get(ReminderSchedule, r.id).status == ReminderStatus.failed
    assert db.get(WhatsAppMessage, r.message_id).error_code == "131049"


def _button(rid, action, sender="919894011111", wamid="wamid.IN1", text="Confirm"):
    return webhook({"contacts": [{"wa_id": sender, "profile": {"name": "Ravi"}}], "messages": [{
        "from": sender, "id": wamid, "timestamp": "1762788100", "type": "button",
        "context": {"from": "914224000000", "id": "wamid.TEST1"},
        "button": {"payload": f"TT1|{action}|{rid}", "text": text}}]})


def test_confirm_button_via_webhook_updates_appointment_once(hospital, public, live, db, staff):
    h, doc = hospital
    r = send_reminder_live(public, doc, db)
    raw, headers = signed(_button(r.id, "CONFIRM"))
    assert Api().post("/api/webhooks/whatsapp", content=raw, headers=headers).json()["messages"] == 1
    assert Api().post("/api/webhooks/whatsapp", content=raw, headers=headers).json()["messages"] == 0  # Meta redelivery
    db.expire_all()
    appt = db.scalar(select(Appointment))
    assert appt.status.value == "confirmed" and appt.confirmed_via == "whatsapp"
    replies = [b for b in live.bodies() if b["type"] == "text"]
    assert len(replies) == 1 and "is confirmed" in replies[0]["text"]["body"]
    assert staff.get("/api/dashboard?date=2026-11-11").json()["day"]["counts"]["confirmed"] == 1


def test_button_payload_from_another_number_is_ignored(hospital, public, live, db):
    h, doc = hospital
    r = send_reminder_live(public, doc, db)
    raw, headers = signed(_button(r.id, "CONFIRM", sender="919800000000", wamid="wamid.SPOOF"))
    Api().post("/api/webhooks/whatsapp", content=raw, headers=headers)
    db.expire_all()
    assert db.scalar(select(Appointment)).status.value == "booked"


def test_reschedule_button_then_patient_link(hospital, public, live, db):
    h, doc = hospital
    r = send_reminder_live(public, doc, db)
    raw, headers = signed(_button(r.id, "RESCHEDULE", text="Reschedule"))
    Api().post("/api/webhooks/whatsapp", content=raw, headers=headers)
    db.expire_all()
    assert db.scalar(select(Appointment)).status.value == "reschedule_requested"
    reply = [b for b in live.bodies() if b["type"] == "text"][0]["text"]["body"]
    token = reply.split("/r/")[1].split()[0]
    info = Api().get(f"/api/public/actions/{token}").json()
    assert info["current"]["start_time"] == "10:30" and "Ravi" not in json.dumps(info)  # no patient data in the link page
    out = Api().post(f"/api/public/actions/{token}/reschedule", json={"date": "2026-11-12", "start_time": "11:15"})
    assert out.status_code == 200, out.text
    db.expire_all()
    appt = db.scalar(select(Appointment))
    assert (appt.scheduled_date.isoformat(), appt.status.value, appt.confirmed_via) == ("2026-11-12", "confirmed", "patient_link")


def test_stop_withdraws_consent(hospital, public, live, db):
    h, doc = hospital
    send_reminder_live(public, doc, db)
    raw, headers = signed(webhook({"messages": [{"from": "919894011111", "id": "wamid.STOP", "timestamp": "1762788100",
                                                  "type": "text", "text": {"body": "stop"}}]}))
    Api().post("/api/webhooks/whatsapp", content=raw, headers=headers)
    db.expire_all()
    assert db.scalar(select(Patient)).whatsapp_consent is False


# ---- simulator -----------------------------------------------------------------------------------------------------
def test_simulator_followup_confirm_books_visit(hospital, public, staff, db):
    h, doc = hospital
    book(public, doc, WED, "10:30")
    a = staff.get("/api/appointments").json()["items"][0]
    at(ist(2026, 11, 11, 10, 45))
    staff.post(f"/api/appointments/{a['id']}/status", json={"status": "completed"})
    fid = staff.post(f"/api/appointments/{a['id']}/followup", json={"due_date": "2026-12-02"}).json()["id"]
    at(ist(2026, 11, 25, 18, 5))
    run_worker(db)
    pid = a["patient"]["id"]
    convo = staff.get(f"/api/messages/conversations/{pid}").json()
    seven = [m for m in convo["messages"] if m["answerable"]][0]
    assert seven["is_simulated"] and seven["status"] == "simulated"
    res = staff.post("/api/messages/simulate-tap", json={"message_id": seven["id"], "action": "CONFIRM"}).json()
    assert res["result"] == "followup_booked"
    fu = staff.get(f"/api/followups/{fid}").json()
    assert fu["status"] == "confirmed" and fu["visit"]["date"] == "2026-12-02" and fu["visit"]["start_time"] == "10:30"
    assert [x["status"] for x in fu["reminders"] if x["kind"] == "followup_3d"] == []  # cancelled, hidden
    convo = staff.get(f"/api/messages/conversations/{pid}").json()["messages"]
    assert convo[-2]["direction"] == "inbound" and convo[-1]["body"].startswith("Thank you, Ravi. Your follow-up visit")
    again = staff.post("/api/messages/simulate-tap", json={"message_id": seven["id"], "action": "CONFIRM"}).json()
    assert again["result"] == "already_recorded"


def test_simulator_refuses_real_messages(hospital, public, live, staff, db):
    h, doc = hospital
    r = send_reminder_live(public, doc, db)
    res = staff.post("/api/messages/simulate-tap", json={"message_id": str(r.message_id), "action": "CONFIRM"})
    assert res.status_code == 422
