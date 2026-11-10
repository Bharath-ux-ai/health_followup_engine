"""Demo hospital tooling: clock control, reset, sample data and the Mr. Ravi scenario.

Safety: every function here refuses to run unless DEMO_MODE is enabled AND the hospital is flagged is_demo.
Sample data is produced by replaying patient journeys through the real services on the demo clock — the
reminders, replies and report figures are genuine outputs of the engine, not inserted numbers.
"""
import os
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.permissions import HOSPITAL_STAFF
from app.models import (
    Appointment, AuditLog, Doctor, DoctorAvailability, FollowUp, FollowUpContact, Hospital, MonthlyReport, Patient,
    ReminderSchedule, User, WhatsAppMessage,
)
from app.models.enums import AppointmentSource, AppointmentStatus as A, Language, ReminderKind
from app.services import appointments, audit, clock, dispatcher, followups, onboarding, patients
from app.services.errors import Forbidden, InvalidInput, NotFound
from app.services.whatsapp import inbound

DEMO_SLUG = "tectha-clinic"
DEFAULT_ANCHOR = date(2026, 11, 9)  # Monday — matches the brief: reminders 25 & 29 Nov for a 2 Dec follow-up


def anchor_date() -> date:
    raw = os.environ.get("DEMO_ANCHOR_DATE")
    return date.fromisoformat(raw) if raw else DEFAULT_ANCHOR


def guard(h: Hospital) -> None:
    if not get_settings().DEMO_MODE or not h.is_demo:
        raise Forbidden("Demo controls are only available for the demo hospital on a demo deployment")


# ---- clock -----------------------------------------------------------------------------
def set_clock(db: Session, h: Hospital, local_dt: datetime) -> None:
    guard(h)
    if local_dt.tzinfo is None:
        local_dt = local_dt.replace(tzinfo=clock.tz(h))
    h.demo_now = local_dt.astimezone(timezone.utc)
    db.flush()


def advance(db: Session, h: Hospital, *, days: int = 0, hours: int = 0) -> None:
    guard(h)
    set_clock(db, h, clock.local_now(h) + timedelta(days=days, hours=hours))


def reset_clock_to_real(db: Session, h: Hospital) -> None:
    guard(h)
    h.demo_now = None
    db.flush()


def run_reminders(db: Session, h: Hospital) -> dict:
    guard(h)
    return dispatcher.run_cycle(db, h)


# ---- setup / reset ------------------------------------------------------------------------
DOCTORS = [
    ("Dr. Arun Kumar", "General Physician", [(d, "09:00", "13:00") for d in range(6)] + [(d, "17:00", "19:00") for d in range(5)]),
    ("Dr. Priya", "Dermatologist", [(d, "10:00", "14:00") for d in (0, 2, 4)]),
    ("Dr. Karthik", "Cardiologist", [(d, "09:30", "13:30") for d in (1, 3, 5)]),
]


def ensure_demo_hospital(db: Session) -> Hospital:
    h = db.scalar(select(Hospital).where(Hospital.slug == DEMO_SLUG))
    if h:
        return h
    password = os.environ.get("DEMO_PASSWORD")
    if not password:
        raise InvalidInput("Set DEMO_PASSWORD in the environment before creating the demo hospital")
    h, _ = onboarding.create_hospital(
        db, name="TEC THA Multispeciality Clinic", slug=DEMO_SLUG, city="Coimbatore", phone="+914224000000",
        admin_name="Demo Admin", admin_email="admin@tectha-demo.in", admin_password=password, is_demo=True,
    )
    h.address = "Avinashi Road, Peelamedu, Coimbatore, Tamil Nadu 641004"
    h.email = "care@tectha-demo.in"
    onboarding.create_user(db, email="staff@tectha-demo.in", full_name="Priya (Reception)", password=password,
                           role_code=HOSPITAL_STAFF, hospital=h)
    for name, spec, windows in DOCTORS:
        doc = Doctor(hospital_id=h.id, name=name, specialty=spec)
        doc.availability = [DoctorAvailability(hospital_id=h.id, weekday=wd, start_time=time.fromisoformat(s),
                                               end_time=time.fromisoformat(e)) for wd, s, e in windows]
        db.add(doc)
    db.flush()
    return h


def wipe(db: Session, h: Hospital) -> None:
    """Delete all patient-related data of the demo hospital (configuration, doctors and users are kept)."""
    guard(h)
    hid = h.id
    db.execute(update(ReminderSchedule).where(ReminderSchedule.hospital_id == hid).values(message_id=None))
    db.execute(delete(WhatsAppMessage).where(WhatsAppMessage.hospital_id == hid))
    db.execute(delete(ReminderSchedule).where(ReminderSchedule.hospital_id == hid))
    db.execute(update(Appointment).where(Appointment.hospital_id == hid).values(followup_id=None))
    db.execute(delete(FollowUpContact).where(FollowUpContact.hospital_id == hid))
    db.execute(delete(FollowUp).where(FollowUp.hospital_id == hid))
    db.execute(delete(Appointment).where(Appointment.hospital_id == hid))
    db.execute(delete(Patient).where(Patient.hospital_id == hid))
    db.execute(delete(MonthlyReport).where(MonthlyReport.hospital_id == hid))
    db.execute(delete(AuditLog).where(AuditLog.hospital_id == hid, AuditLog.action != "demo.reset"))
    db.expire_all()


def reset(db: Session, h: Hospital, *, with_samples: bool = True, user_id=None) -> dict:
    guard(h)
    wipe(db, h)
    set_clock(db, h, datetime.combine(anchor_date() - timedelta(days=35), time(9, 0)))
    result = load_samples(db, h) if with_samples else {"patients": 0}
    set_clock(db, h, datetime.combine(anchor_date(), time(9, 0)))
    dispatcher.run_cycle(db, h)
    audit.record(db, "demo.reset", hospital_id=h.id, user_id=user_id, details={"with_samples": with_samples})
    db.commit()
    return result


# ---- sample journeys ------------------------------------------------------------------------------
SAMPLE_PATIENTS = {
    "lakshmi": ("Lakshmi Narayanan", "+919894012301", Language.ta, True),
    "senthil": ("Senthil Kumar", "+919894012302", Language.ta, True),
    "meena": ("Meena Sundaram", "+919894012303", Language.en, True),
    "karthikeyan": ("Karthikeyan Ramasamy", "+919894012304", Language.ta, True),
    "divya": ("Divya Prakash", "+919894012305", Language.en, True),
    "murugan": ("Murugan Selvaraj", "+919894012306", Language.ta, True),
    "anitha": ("Anitha Rajendran", "+919894012307", Language.en, False),  # no WhatsApp consent
    "balaji": ("Balaji Venkatesh", "+919894012308", Language.en, True),
    "kavitha": ("Kavitha Mohan", "+919894012309", Language.ta, True),
    "suresh": ("Suresh Babu", "+919894012310", Language.en, True),
    "revathi": ("Revathi Krishnan", "+919894012311", Language.ta, True),
    "ganesh": ("Ganesh Palanisamy", "+919894012312", Language.en, True),
}

ARUN, PRIYA, KARTHIK = "Dr. Arun Kumar", "Dr. Priya", "Dr. Karthik"

# (when: (day offset from anchor, "HH:MM"), action, args). Offsets are relative to the anchor Monday.
JOURNEYS = [
    # Lakshmi: visit → follow-up → confirmed from 3-day reminder → returned  (counts as brought back)
    ((-34, "10:00"), "book", ("lakshmi", ARUN, -33, "10:00", "online", "l1")),
    ((-34, "19:00"), "tap", ("l1", "appt", "CONFIRM")),
    ((-33, "10:20"), "complete", ("l1",)),
    ((-33, "10:30"), "followup", ("l1", -12, "lf")),
    ((-15, "19:30"), "tap", ("lf", "fu3", "CONFIRM")),
    ((-12, "10:20"), "complete_fu_visit", ("lf",)),
    # Senthil: follow-up → taps Reschedule → picks another day via link → returned  (brought back)
    ((-32, "11:00"), "book", ("senthil", KARTHIK, -30, "09:30", "staff", "s1")),
    ((-30, "10:00"), "complete", ("s1",)),
    ((-30, "10:10"), "followup", ("s1", -9, "sf")),
    ((-16, "20:00"), "tap", ("sf", "fu7", "RESCHEDULE")),
    ((-16, "20:05"), "link_fu", ("sf", -6, "09:30")),
    ((-6, "09:55"), "complete_fu_visit", ("sf",)),
    # Meena: reminders sent, no response, date passed → overdue (red, missed)
    ((-27, "12:00"), "book", ("meena", PRIYA, -26, "11:00", "online", "m1")),
    ((-26, "11:30"), "complete", ("m1",)),
    ((-26, "11:40"), "followup", ("m1", -5, "mf")),
    # Murugan: confirmed follow-up visit but did not come → overdue; staff called, no answer
    ((-29, "09:00"), "book", ("murugan", ARUN, -28, "09:15", "online", "u1")),
    ((-28, "09:40"), "complete", ("u1",)),
    ((-28, "09:50"), "followup", ("u1", -14, "uf")),
    ((-21, "18:40"), "tap", ("uf", "fu7", "CONFIRM")),
    ((-14, "18:00"), "no_show_fu_visit", ("uf",)),
    ((-13, "11:00"), "contact", ("uf", "no_answer", "Called twice, no answer")),
    # Anitha: no WhatsApp consent → no reminders; walked in on her follow-up date → returned, NOT attributed
    ((-25, "09:00"), "book", ("anitha", ARUN, -25, "11:30", "staff", "a1")),
    ((-25, "11:50"), "complete", ("a1",)),
    ((-25, "12:00"), "followup", ("a1", -4, "af")),
    ((-4, "10:00"), "walk_in", ("anitha", ARUN, -4, "12:00", "a2")),
    ((-4, "12:20"), "complete", ("a2",)),
    # Karthikeyan: 7- and 3-day reminders sent, no response, due in 2 days → unconfirmed (red)
    ((-21, "09:30"), "book", ("karthikeyan", ARUN, -20, "10:15", "online", "k1")),
    ((-20, "10:40"), "complete", ("k1",)),
    ((-20, "10:45"), "followup", ("k1", 2, "kf")),
    # Divya: upcoming follow-up, reminders still scheduled
    ((-19, "10:00"), "book", ("divya", PRIYA, -19, "12:15", "staff", "d1")),
    ((-19, "12:40"), "complete", ("d1",)),
    ((-19, "12:45"), "followup", ("d1", 11, "df")),
    # Ganesh: earlier completed visit, booked again this week (returning patient)
    ((-18, "10:00"), "book", ("ganesh", ARUN, -17, "17:15", "online", "g1")),
    ((-17, "17:40"), "complete", ("g1",)),
    ((-1, "11:00"), "book", ("ganesh", ARUN, 2, "11:00", "online", "g2")),
    # Balaji: booked then cancelled
    ((-11, "16:00"), "book", ("balaji", KARTHIK, -9, "10:30", "online", "b1")),
    ((-10, "19:10"), "cancel", ("b1", "Travelling out of town")),
    # Kavitha: today, confirmed from yesterday's reminder
    ((-3, "15:00"), "book", ("kavitha", PRIYA, 0, "11:00", "online", "kv")),
    ((-1, "18:30"), "tap", ("kv", "appt", "CONFIRM")),
    # Suresh: today, reminder sent, no reply yet (pending confirmation)
    ((-1, "20:00"), "book", ("suresh", ARUN, 0, "12:00", "online", "su")),
    # Revathi: tomorrow — reminder goes out this evening
    ((-2, "10:30"), "book", ("revathi", KARTHIK, 1, "10:00", "staff", "rv")),
]


def load_samples(db: Session, h: Hospital) -> dict:
    guard(h)
    docs = {d.name: d for d in db.scalars(select(Doctor).where(Doctor.hospital_id == h.id))}
    people: dict[str, Patient] = {}
    objs: dict[str, object] = {}
    anchor = anchor_date()

    def at(offset: int, hhmm: str) -> datetime:
        return datetime.combine(anchor + timedelta(days=offset), time.fromisoformat(hhmm))

    def patient(key: str) -> Patient:
        if key not in people:
            name, phone, lang, consent = SAMPLE_PATIENTS[key]
            people[key] = patients.find_or_create(db, h, full_name=name, phone=phone, language=lang, consent=consent,
                                                  consent_source="booking_form", is_demo=True)
        return people[key]

    def reminder_message(entity_key: str, kind: str) -> WhatsAppMessage:
        rk = {"appt": ReminderKind.appointment_1d, "fu7": ReminderKind.followup_7d, "fu3": ReminderKind.followup_3d}[kind]
        col = ReminderSchedule.appointment_id if kind == "appt" else ReminderSchedule.followup_id
        r = db.scalar(select(ReminderSchedule).where(col == objs[entity_key].id, ReminderSchedule.kind == rk)
                      .order_by(ReminderSchedule.created_at.desc()))
        return db.get(WhatsAppMessage, r.message_id)

    # Daily ticks at the reminder send time so reminders go out exactly when the real worker would send them.
    send = h.reminder_send_time
    events = [(at(off, hhmm), action, args) for (off, hhmm), action, args in JOURNEYS]
    events += [(datetime.combine(anchor + timedelta(days=d), send) + timedelta(minutes=1), "tick", ()) for d in range(-35, 1)]
    events.sort(key=lambda e: (e[0], e[1] != "tick"))

    for when, action, args in events:
        if when > datetime.combine(anchor, time(9, 0)):
            continue
        set_clock(db, h, when)
        if action == "tick":
            dispatcher.run_cycle(db, h)
        elif action in ("book", "walk_in"):
            pkey, doc, day, hhmm, *rest = args
            src = rest[0] if action == "book" else "staff"
            objs[rest[-1]] = appointments.book(db, h, patient=patient(pkey), doctor_id=docs[doc].id,
                                               d=anchor + timedelta(days=day), start_time=time.fromisoformat(hhmm),
                                               source=AppointmentSource(src))
        elif action == "complete":
            appointments.change_status(db, h, objs[args[0]], A.completed)
        elif action == "cancel":
            appointments.change_status(db, h, objs[args[0]], A.cancelled, reason=args[1])
        elif action == "followup":
            objs[args[2]] = followups.create(db, h, objs[args[0]], anchor + timedelta(days=args[1]))
        elif action == "tap":
            inbound.simulate_tap(db, h, reminder_message(args[0], args[1]), args[2])
        elif action == "link_fu":
            inbound.reschedule_via_link(db, "fu", objs[args[0]].id, anchor + timedelta(days=args[1]), time.fromisoformat(args[2]))
        elif action in ("complete_fu_visit", "no_show_fu_visit"):
            visit = followups.booked_visit(db, objs[args[0]])
            appointments.change_status(db, h, visit, A.completed if action == "complete_fu_visit" else A.no_show)
        elif action == "contact":
            followups.log_contact(db, h, objs[args[0]], args[1], args[2], user_id=None)
        db.commit()
    return {"patients": len(people), "appointments": sum(isinstance(o, Appointment) for o in objs.values())}


# ---- Mr. Ravi scenario ------------------------------------------------------------------------------
def scenario(db: Session, h: Hospital) -> dict:
    guard(h)
    anchor = anchor_date()
    ravi = db.scalar(select(Patient).where(Patient.hospital_id == h.id, Patient.name_key == "ravi", Patient.deleted_at.is_(None)))
    appt = fu = None
    if ravi:
        appt = db.scalar(select(Appointment).where(Appointment.patient_id == ravi.id, Appointment.followup_id.is_(None))
                         .order_by(Appointment.created_at).limit(1))
        fu = db.scalar(select(FollowUp).where(FollowUp.patient_id == ravi.id).order_by(FollowUp.created_at.desc()).limit(1))
    d = lambda n: (anchor + timedelta(days=n)).isoformat()  # noqa: E731
    return {
        "anchor": anchor.isoformat(),
        "now": clock.local_now(h).isoformat(),
        "visit_date": d(2), "followup_date": d(23), "reminder_7d": d(16), "reminder_3d": d(20),
        "patient_id": str(ravi.id) if ravi else None,
        "appointment": {"id": str(appt.id), "status": appt.status.value, "reference": appt.reference} if appt else None,
        "followup": {"id": str(fu.id), "status": fu.status.value, "due_date": fu.due_date.isoformat(),
                     "attention": followups.attention(db, h, fu)} if fu else None,
        "steps": [
            {"key": "book", "title": "Mr. Ravi books online", "clock": f"{d(0)}T10:00"},
            {"key": "reminder", "title": "Tuesday-evening reminder → Confirm", "clock": f"{d(1)}T18:05", "run": True},
            {"key": "visit", "title": "Wednesday visit → mark completed", "clock": f"{d(2)}T10:45"},
            {"key": "followup", "title": "Staff sets follow-up for 2 December", "clock": f"{d(2)}T10:50"},
            {"key": "r7", "title": "7-day reminder (25 Nov)", "clock": f"{d(16)}T18:05", "run": True},
            {"key": "r3", "title": "3-day reminder (29 Nov)", "clock": f"{d(20)}T18:05", "run": True},
            {"key": "red", "title": "No response → turns red", "clock": f"{d(21)}T10:00", "run": True},
            {"key": "overdue", "title": "Date passes → overdue, staff calls", "clock": f"{d(24)}T10:00", "run": True},
        ],
    }


def book_ravi(db: Session, h: Hospital, phone: str | None = None) -> Appointment:
    """Shortcut for presenters: book Mr. Ravi (Dr. Arun Kumar, Wednesday 10:30) exactly as the public page would."""
    guard(h)
    doc = db.scalar(select(Doctor).where(Doctor.hospital_id == h.id, Doctor.name == ARUN))
    if not doc:
        raise NotFound("Dr. Arun Kumar is not configured")
    p = patients.find_or_create(db, h, full_name="Ravi", phone=phone or "+919894099999", language=Language.en,
                                consent=True, consent_source="booking_form", is_demo=phone is None)
    return appointments.book(db, h, patient=p, doctor_id=doc.id, d=anchor_date() + timedelta(days=2),
                             start_time=time(10, 30), source=AppointmentSource.online)


def simulate_no_response(db: Session, h: Hospital, fu: FollowUp) -> None:
    """Jump to the point where an unanswered follow-up turns red (after its reminders have gone out)."""
    guard(h)
    target = datetime.combine(fu.due_date - timedelta(days=get_settings().FOLLOWUP_RED_DAYS), time(10, 0))
    if target.replace(tzinfo=clock.tz(h)) > clock.local_now(h):
        set_clock(db, h, target)
    dispatcher.run_cycle(db, h)
