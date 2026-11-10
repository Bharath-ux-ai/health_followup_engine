"""Batch loaders + composed read models used by list screens and the dashboard (avoid N+1 queries)."""
import uuid
from collections import defaultdict
from datetime import time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Appointment, FollowUp, Hospital, ReminderSchedule, WhatsAppMessage
from app.models.enums import (
    ACTIVE_APPOINTMENT_STATUSES, OPEN_FOLLOWUP_STATUSES, AppointmentStatus as A, FollowUpStatus as F, MessageDirection,
    MessageStatus as M, ReminderStatus,
)
from app.schemas import serializers as ser
from app.services import clock, followups, reports


def _messages(db: Session, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {m.id: m for m in db.scalars(select(WhatsAppMessage).where(WhatsAppMessage.id.in_(ids)))}


def appointment_reminders(db: Session, appt_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    if not appt_ids:
        return {}
    rows = db.scalars(select(ReminderSchedule).where(ReminderSchedule.appointment_id.in_(appt_ids))
                      .order_by(ReminderSchedule.created_at)).all()
    latest: dict = {}
    for r in rows:
        prev = latest.get(r.appointment_id)
        if prev is None or r.status != ReminderStatus.cancelled or prev.status == ReminderStatus.cancelled:
            latest[r.appointment_id] = r
    msgs = _messages(db, {r.message_id for r in latest.values()})
    return {k: ser.reminder(r, msgs.get(r.message_id)) for k, r in latest.items()}


def appointments_out(db: Session, appts: list[Appointment]) -> list[dict]:
    rems = appointment_reminders(db, [a.id for a in appts])
    return [ser.appointment(a, rems.get(a.id)) for a in appts]


def followups_out(db: Session, h: Hospital, fus: list[FollowUp]) -> list[dict]:
    ids = [f.id for f in fus]
    rem_rows: dict = defaultdict(list)
    visits: dict = {}
    if ids:
        for r in db.scalars(select(ReminderSchedule).where(ReminderSchedule.followup_id.in_(ids)).order_by(ReminderSchedule.scheduled_for)):
            rem_rows[r.followup_id].append(r)
        for a in db.scalars(select(Appointment).where(Appointment.followup_id.in_(ids)).order_by(Appointment.created_at)):
            visits[a.followup_id] = a
    msgs = _messages(db, {r.message_id for rows in rem_rows.values() for r in rows})
    out = []
    for f in fus:
        rows = rem_rows.get(f.id, [])
        out.append(ser.followup(
            f, followups.attention(db, h, f, rows),
            [ser.reminder(r, msgs.get(r.message_id)) for r in rows if r.status != ReminderStatus.cancelled or r.sent_at],
            visits.get(f.id)))
    return out


def attention_followups(db: Session, h: Hospital, limit: int = 100) -> list[dict]:
    today = clock.today(h)
    candidates = db.scalars(select(FollowUp).where(
        FollowUp.hospital_id == h.id,
        ((FollowUp.status == F.missed)) | (FollowUp.status.in_(OPEN_FOLLOWUP_STATUSES) & (FollowUp.due_date <= today + timedelta(days=7))),
    ).order_by(FollowUp.due_date).limit(500)).all()
    return [f for f in followups_out(db, h, candidates) if f["attention"]][:limit]


def dashboard(db: Session, h: Hospital, day=None) -> dict:
    today = clock.today(h)
    day = day or today
    month_start, month_end = clock.month_bounds(today.year, today.month)

    day_appts = db.scalars(select(Appointment).where(Appointment.hospital_id == h.id, Appointment.scheduled_date == day)
                           .order_by(Appointment.start_time)).all()
    day_counts = {s.value: sum(a.status == s for a in day_appts) for s in A}

    month_counts = dict(db.execute(select(Appointment.status, func.count()).where(
        Appointment.hospital_id == h.id, Appointment.scheduled_date >= month_start,
        Appointment.scheduled_date <= month_end).group_by(Appointment.status)).all())

    upcoming_fu = db.scalars(select(FollowUp).where(
        FollowUp.hospital_id == h.id, FollowUp.status.in_(OPEN_FOLLOWUP_STATUSES),
        FollowUp.due_date >= today, FollowUp.due_date <= today + timedelta(days=30)).order_by(FollowUp.due_date).limit(20)).all()
    attention = attention_followups(db, h)

    reschedule_requests = db.scalars(select(Appointment).where(
        Appointment.hospital_id == h.id, Appointment.status == A.reschedule_requested,
        Appointment.scheduled_date >= today).order_by(Appointment.scheduled_date, Appointment.start_time).limit(20)).all()

    lo = clock.local_to_utc(h, month_start, time(0))
    msg_counts = dict(db.execute(select(WhatsAppMessage.status, func.count()).where(
        WhatsAppMessage.hospital_id == h.id, WhatsAppMessage.direction == MessageDirection.outbound,
        WhatsAppMessage.kind == "template", WhatsAppMessage.reminder_id.is_not(None),
        WhatsAppMessage.occurred_at >= lo).group_by(WhatsAppMessage.status)).all())
    failed_reminders = db.scalar(select(func.count()).select_from(ReminderSchedule).where(
        ReminderSchedule.hospital_id == h.id, ReminderSchedule.status == ReminderStatus.failed)) or 0
    pending_reminders = db.scalar(select(func.count()).select_from(ReminderSchedule).where(
        ReminderSchedule.hospital_id == h.id, ReminderSchedule.status == ReminderStatus.pending)) or 0
    open_followups = db.scalar(select(func.count()).select_from(FollowUp).where(
        FollowUp.hospital_id == h.id, FollowUp.status.in_(OPEN_FOLLOWUP_STATUSES), FollowUp.due_date >= today)) or 0
    missed_followups = db.scalar(select(func.count()).select_from(FollowUp).where(
        FollowUp.hospital_id == h.id, FollowUp.status == F.missed)) or 0
    bb = reports.brought_back(db, h, today.year, today.month)
    month_report_fu = db.execute(select(FollowUp.status, func.count()).where(
        FollowUp.hospital_id == h.id, FollowUp.due_date >= month_start, FollowUp.due_date <= month_end,
        FollowUp.status != F.cancelled).group_by(FollowUp.status)).all()
    fu_month = {s: n for s, n in month_report_fu}
    resolved = fu_month.get(F.completed, 0) + fu_month.get(F.missed, 0)

    return {
        "today": today.isoformat(), "date": day.isoformat(), "now": clock.now(h).isoformat(),
        "demo_clock": clock.demo_clock_active(h),
        "day": {"counts": day_counts, "total": len(day_appts), "appointments": appointments_out(db, list(day_appts))},
        "month": {
            "label": month_start.strftime("%B %Y"),
            "appointments_total": sum(month_counts.values()),
            "completed": month_counts.get(A.completed, 0), "cancelled": month_counts.get(A.cancelled, 0),
            "confirmed": month_counts.get(A.confirmed, 0), "pending": month_counts.get(A.booked, 0),
            "no_show": month_counts.get(A.no_show, 0),
            "reminders_sent": sum(msg_counts.get(s, 0) for s in (M.sent, M.delivered, M.read)),
            "reminders_simulated": msg_counts.get(M.simulated, 0),
            "reminders_failed": msg_counts.get(M.failed, 0),
            "brought_back": bb["brought_back"],
            "followups_due": sum(fu_month.values()), "followups_returned": fu_month.get(F.completed, 0),
            "followup_return_rate": round(100 * fu_month.get(F.completed, 0) / resolved, 1) if resolved else None,
        },
        "followups": {"upcoming": followups_out(db, h, list(upcoming_fu)), "attention": attention,
                      "open_count": open_followups, "missed_count": missed_followups,
                      "unconfirmed_count": sum(1 for f in attention if f["attention"] == "unconfirmed")},
        "reschedule_requests": appointments_out(db, list(reschedule_requests)),
        "reminders": {"failed": failed_reminders, "pending": pending_reminders},
    }
