"""Appointment booking, double-booking prevention, patients, status changes and rescheduling."""
import threading
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import Appointment, Patient
from tests.conftest import Api, at, book, ist

WED = date(2026, 11, 11)


def test_public_page_exposes_no_patient_data(hospital, public):
    h, doc = hospital
    book(public, doc, WED, "10:30", name="Ravi", phone="9894011111")
    page = public.get("/api/public/hospitals/sunrise").json()
    assert page["name"] == "Sunrise Clinic" and page["doctors"][0]["name"] == "Dr. Arun Kumar"
    slots = public.get(f"/api/public/hospitals/sunrise/slots?doctor_id={doc.id}&date=2026-11-11").text
    assert "Ravi" not in slots and "9894011111" not in slots
    taken = [s for s in public.get(f"/api/public/hospitals/sunrise/slots?doctor_id={doc.id}&date=2026-11-11").json()["slots"] if not s["available"]]
    assert [s["start_time"] for s in taken] == ["10:30"]


def test_booking_creates_patient_appointment_and_reference(hospital, public, db, admin):
    h, doc = hospital
    r = book(public, doc, WED, "10:30", name="Mr. Ravi")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["reference"].startswith("TT-") and len(body["reference"]) == 9
    assert body["doctor"] == "Dr. Arun Kumar" and body["start_time"] == "10:30" and body["whatsapp_reminder"] is True
    appt = db.scalar(select(Appointment))
    assert appt.status.value == "booked" and appt.patient.phone == "+919894011111" and appt.patient.whatsapp_consent
    assert admin.get("/api/dashboard?date=2026-11-11").json()["day"]["total"] == 1


def test_double_booking_prevented(hospital, public):
    h, doc = hospital
    assert book(public, doc, WED, "10:30", name="Ravi").status_code == 201
    r = book(public, doc, WED, "10:30", name="Lakshmi", phone="9894022222")
    assert r.status_code == 409 and r.json()["code"] == "slot_taken"


def test_concurrent_bookings_only_one_wins(hospital, db):
    h, doc = hospital
    results = []

    def attempt(i):
        c = TestClient(app)
        results.append(c.post("/api/public/hospitals/sunrise/appointments", json={
            "full_name": f"Patient {i}", "phone": f"98940{i:05d}", "doctor_id": str(doc.id),
            "date": "2026-11-11", "start_time": "11:00", "whatsapp_consent": True}).status_code)

    threads = [threading.Thread(target=attempt, args=(i,)) for i in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count(201) == 1 and results.count(409) == 7
    assert db.scalar(select(func.count()).select_from(Appointment)) == 1


def test_same_patient_cannot_double_book_same_day(hospital, public):
    h, doc = hospital
    assert book(public, doc, WED, "10:30").status_code == 201
    r = book(public, doc, WED, "11:30")
    assert r.status_code == 409 and r.json()["code"] == "duplicate_booking"


def test_patient_deduplication(hospital, public, db):
    h, doc = hospital
    book(public, doc, WED, "10:30", name="Mr. Ravi", phone="+91 98940 11111")
    book(public, doc, date(2026, 11, 12), "10:30", name="ravi", phone="09894011111")
    book(public, doc, date(2026, 11, 13), "10:30", name="Meena Ravi", phone="9894011111")  # family member, same phone
    names = sorted(p.full_name for p in db.scalars(select(Patient)))
    assert names == ["Meena Ravi", "Mr. Ravi"]


def test_booking_validation(hospital, public):
    h, doc = hospital
    assert book(public, doc, date(2026, 11, 6), "10:30").status_code == 422  # past
    assert book(public, doc, date(2026, 11, 15), "10:30").status_code == 422  # Sunday: not available
    assert book(public, doc, WED, "10:37").status_code == 422  # not a slot
    assert book(public, doc, date(2027, 3, 1), "10:30").status_code == 422  # beyond booking window
    assert book(public, doc, WED, "10:30", phone="12345").status_code == 422
    assert book(public, doc, WED, "10:30", name="1").status_code == 422
    at(ist(2026, 11, 11, 10, 20))
    assert book(public, doc, WED, "10:30").status_code == 422  # same day, inside the lead time
    r = public.post("/api/public/hospitals/sunrise/appointments", json={
        "full_name": "Bot", "phone": "9894033333", "doctor_id": str(doc.id), "date": "2026-11-12",
        "start_time": "10:30", "website": "spam"})
    assert r.status_code == 422  # honeypot


def test_staff_registers_and_confirms(hospital, staff):
    h, doc = hospital
    r = staff.post("/api/appointments", json={"full_name": "Senthil", "phone": "9894044444", "doctor_id": str(doc.id),
                                             "date": "2026-11-10", "start_time": "09:30", "whatsapp_consent": True, "mark_confirmed": True})
    assert r.status_code == 201 and r.json()["status"] == "confirmed" and r.json()["source"] == "staff"


def test_status_transitions(hospital, public, staff):
    h, doc = hospital
    book(public, doc, WED, "10:30")
    a = staff.get("/api/appointments").json()["items"][0]
    r = staff.post(f"/api/appointments/{a['id']}/status", json={"status": "completed"})
    assert r.status_code == 422  # cannot complete before the visit date
    assert staff.post(f"/api/appointments/{a['id']}/status", json={"status": "confirmed"}).json()["status"] == "confirmed"
    at(ist(2026, 11, 11, 10, 45))
    assert staff.post(f"/api/appointments/{a['id']}/status", json={"status": "completed"}).json()["status"] == "completed"
    assert staff.post(f"/api/appointments/{a['id']}/status", json={"status": "cancelled"}).status_code == 422


def test_cancel_frees_slot(hospital, public, staff):
    h, doc = hospital
    book(public, doc, WED, "10:30")
    a = staff.get("/api/appointments").json()["items"][0]
    staff.post(f"/api/appointments/{a['id']}/status", json={"status": "cancelled", "reason": "Patient called"})
    assert book(public, doc, WED, "10:30", name="Lakshmi", phone="9894022222").status_code == 201


def test_staff_reschedule(hospital, public, staff, db):
    h, doc = hospital
    book(public, doc, WED, "10:30")
    book(public, doc, WED, "11:00", name="Lakshmi", phone="9894022222")
    a = [x for x in staff.get("/api/appointments").json()["items"] if x["patient"]["full_name"] == "Ravi"][0]
    r = staff.post(f"/api/appointments/{a['id']}/reschedule", json={"date": "2026-11-11", "start_time": "11:00"})
    assert r.status_code == 409  # taken by Lakshmi
    r = staff.post(f"/api/appointments/{a['id']}/reschedule", json={"date": "2026-11-12", "start_time": "09:15"})
    assert r.status_code == 200 and r.json()["date"] == "2026-11-12" and r.json()["status"] == "booked"
    assert book(public, doc, WED, "10:30", name="Kavitha", phone="9894055555").status_code == 201  # old slot released


def test_search_and_filters(hospital, public, staff):
    h, doc = hospital
    book(public, doc, WED, "10:30", name="Ravi")
    book(public, doc, date(2026, 11, 12), "10:30", name="Lakshmi", phone="9894022222")
    assert staff.get("/api/appointments?q=laks").json()["total"] == 1
    assert staff.get("/api/appointments?q=4011111").json()["total"] == 1
    assert staff.get("/api/appointments?date_from=2026-11-12&date_to=2026-11-12").json()["total"] == 1
    assert staff.get("/api/appointments?status=confirmed").json()["total"] == 0
    assert staff.get("/api/patients?q=ravi").json()["total"] == 1
