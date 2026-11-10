"""Monthly report.

"We brought back X patients this month" counts DISTINCT patients whose follow-up was completed (a return visit was
recorded) during the month AND who had been sent a follow-up reminder for that follow-up before the visit.
Returns without any reminder are reported separately and never attributed to reminders. For real hospitals only
WhatsApp-accepted messages count; simulated messages count only for demo hospitals (and the report says so).
"""
import csv
import io
from collections import Counter
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Appointment, FollowUp, Hospital, ReminderSchedule, WhatsAppMessage
from app.models.enums import AppointmentStatus as A, FollowUpStatus as F, MessageDirection, MessageStatus as M, ReminderKind
from app.services import clock

LIVE_COUNTED = (M.sent, M.delivered, M.read)


def _utc_range(h: Hospital, start: date, end: date) -> tuple[datetime, datetime]:
    return clock.local_to_utc(h, start, time(0)), clock.local_to_utc(h, end + timedelta(days=1), time(0))


def _counted_statuses(h: Hospital):
    return LIVE_COUNTED + ((M.simulated,) if h.is_demo else ())


def brought_back(db: Session, h: Hospital, year: int, month: int) -> dict:
    start, end = clock.month_bounds(year, month)
    lo, hi = _utc_range(h, start, end)
    completed = db.scalars(select(FollowUp).where(
        FollowUp.hospital_id == h.id, FollowUp.status == F.completed,
        FollowUp.completed_at >= lo, FollowUp.completed_at < hi)).all()
    attributed, unattributed = set(), set()
    for fu in completed:
        reminded = db.scalar(select(WhatsAppMessage.id).where(
            WhatsAppMessage.followup_id == fu.id, WhatsAppMessage.direction == MessageDirection.outbound,
            WhatsAppMessage.kind == "template", WhatsAppMessage.status.in_(_counted_statuses(h)),
            WhatsAppMessage.occurred_at <= fu.completed_at).limit(1))
        (attributed if reminded else unattributed).add(fu.patient_id)
    return {"brought_back": len(attributed), "returned_without_reminder": len(unattributed - attributed),
            "followups_completed_in_month": len(completed)}


def monthly(db: Session, h: Hospital, year: int, month: int, *, with_trend: bool = True) -> dict:
    start, end = clock.month_bounds(year, month)
    lo, hi = _utc_range(h, start, end)

    appts = db.scalars(select(Appointment).where(
        Appointment.hospital_id == h.id, Appointment.scheduled_date >= start, Appointment.scheduled_date <= end)).all()
    by_status = Counter(a.status for a in appts)
    resolved = by_status[A.completed] + by_status[A.no_show]

    fus = db.scalars(select(FollowUp).where(
        FollowUp.hospital_id == h.id, FollowUp.due_date >= start, FollowUp.due_date <= end,
        FollowUp.status != F.cancelled)).all()
    fu_status = Counter(f.status for f in fus)
    fu_resolved = fu_status[F.completed] + fu_status[F.missed]

    msgs = db.scalars(select(WhatsAppMessage).where(
        WhatsAppMessage.hospital_id == h.id, WhatsAppMessage.direction == MessageDirection.outbound,
        WhatsAppMessage.kind == "template", WhatsAppMessage.occurred_at >= lo, WhatsAppMessage.occurred_at < hi,
        WhatsAppMessage.reminder_id.is_not(None))).all()
    msg_status = Counter(m.status for m in msgs)
    responses = db.scalars(select(ReminderSchedule).where(
        ReminderSchedule.hospital_id == h.id, ReminderSchedule.responded_at >= lo, ReminderSchedule.responded_at < hi)).all()

    patients_seen = {a.patient_id for a in appts if a.status == A.completed}
    returning = set()
    if patients_seen:
        returning = set(db.scalars(select(Appointment.patient_id).where(
            Appointment.hospital_id == h.id, Appointment.patient_id.in_(patients_seen),
            Appointment.status == A.completed, Appointment.scheduled_date < start)))

    bb = brought_back(db, h, year, month)
    daily = []
    for i in range((end - start).days + 1):
        d = start + timedelta(days=i)
        day = [a for a in appts if a.scheduled_date == d]
        daily.append({"date": d.isoformat(), "total": len(day),
                      "completed": sum(a.status == A.completed for a in day),
                      "cancelled": sum(a.status == A.cancelled for a in day),
                      "no_show": sum(a.status == A.no_show for a in day)})

    def pct(n: int, d: int) -> float | None:
        return round(100 * n / d, 1) if d else None

    x = bb["brought_back"]
    report = {
        "hospital": h.name, "year": year, "month": month, "period_label": start.strftime("%B %Y"),
        "generated_at": clock.now(h).isoformat(), "includes_simulated_messages": h.is_demo,
        "appointments": {
            "total": len(appts), "completed": by_status[A.completed], "cancelled": by_status[A.cancelled],
            "missed": by_status[A.no_show], "confirmed_pending_visit": by_status[A.confirmed],
            "awaiting_confirmation": by_status[A.booked], "reschedule_requested": by_status[A.reschedule_requested],
            "attendance_rate": pct(by_status[A.completed], resolved),
            "online_bookings": sum(a.source.value == "online" for a in appts),
            "confirmed_via_whatsapp": sum(a.confirmed_via == "whatsapp" for a in appts),
        },
        "followups": {
            "scheduled": len(fus), "completed": fu_status[F.completed], "missed": fu_status[F.missed],
            "open": fu_status[F.scheduled] + fu_status[F.confirmed] + fu_status[F.rescheduled],
            "return_rate": pct(fu_status[F.completed], fu_resolved),
        },
        "retention": {
            "brought_back": x, "returned_without_reminder": bb["returned_without_reminder"],
            "unique_patients_seen": len(patients_seen), "returning_patients": len(returning),
            "returning_patient_share": pct(len(returning), len(patients_seen)),
        },
        "reminders": {
            "total": len(msgs), "sent": msg_status[M.sent], "delivered": msg_status[M.delivered], "read": msg_status[M.read],
            "simulated": msg_status[M.simulated], "failed": msg_status[M.failed],
            "appointment_reminders": sum((m.meta or {}).get("reminder_kind") == ReminderKind.appointment_1d.value for m in msgs),
            "followup_reminders": sum((m.meta or {}).get("reminder_kind") in (ReminderKind.followup_7d.value, ReminderKind.followup_3d.value) for m in msgs),
            "confirmations": sum(r.response and r.response.value == "confirmed" for r in responses),
            "reschedule_requests": sum(r.response and r.response.value == "reschedule_requested" for r in responses),
        },
        "daily": daily,
        "summary": f"We brought back {x} patient{'s' if x != 1 else ''} this month.",
        "summary_detail": (
            f"{fu_status[F.completed]} of {fu_resolved} follow-up patients due this month returned"
            + (f" ({pct(fu_status[F.completed], fu_resolved)}%)." if fu_resolved else ".")
            + f" Counted only when a return visit was recorded after a follow-up reminder."
        ),
    }
    if with_trend:
        trend = []
        y, m = year, month
        for _ in range(6):
            r = monthly(db, h, y, m, with_trend=False)
            trend.append({"label": date(y, m, 1).strftime("%b %Y"), "appointments": r["appointments"]["total"],
                          "completed": r["appointments"]["completed"], "cancelled": r["appointments"]["cancelled"],
                          "missed": r["appointments"]["missed"], "brought_back": r["retention"]["brought_back"],
                          "followups_due": r["followups"]["scheduled"], "followups_completed": r["followups"]["completed"]})
            y, m = (y, m - 1) if m > 1 else (y - 1, 12)
        report["trend"] = list(reversed(trend))
    return report


def to_csv(report: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["TEC THA Follow-Up Engine — Monthly Report"])
    w.writerow(["Hospital", report["hospital"]])
    w.writerow(["Period", report["period_label"]])
    w.writerow(["Generated", report["generated_at"]])
    w.writerow([])
    w.writerow(["Summary", report["summary"]])
    w.writerow(["", report["summary_detail"]])
    if report["includes_simulated_messages"]:
        w.writerow(["Note", "Demo hospital: simulated WhatsApp messages are included."])
    for section in ("appointments", "followups", "retention", "reminders"):
        w.writerow([])
        w.writerow([section.title()])
        for k, v in report[section].items():
            w.writerow([k.replace("_", " ").capitalize(), "" if v is None else v])
    w.writerow([])
    w.writerow(["Daily appointments"])
    w.writerow(["Date", "Total", "Completed", "Cancelled", "Missed"])
    for d in report["daily"]:
        w.writerow([d["date"], d["total"], d["completed"], d["cancelled"], d["no_show"]])
    return buf.getvalue()
