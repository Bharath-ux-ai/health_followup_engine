"""WhatsApp conversations (inbox + simulator), message log and reminder retries."""
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select

from app.api.deps import Ctx, owned, require
from app.models import Patient, ReminderSchedule, WhatsAppMessage
from app.models.enums import MessageStatus, ReminderStatus
from app.schemas import serializers as ser
from app.schemas.requests import RetryIn, SimulateTapIn
from app.services import audit, dispatcher
from app.services.whatsapp import inbound, outbound

router = APIRouter(prefix="/messages", tags=["messages"])


@router.get("/conversations")
def conversations(ctx: Ctx = Depends(require("messages.view")), q: str | None = Query(None, max_length=80)):
    last = (select(WhatsAppMessage.patient_id, func.max(WhatsAppMessage.occurred_at).label("last_at"), func.count().label("n"))
            .where(WhatsAppMessage.hospital_id == ctx.hospital.id, WhatsAppMessage.patient_id.is_not(None))
            .group_by(WhatsAppMessage.patient_id).subquery())
    stmt = select(Patient, last.c.last_at, last.c.n).join(last, last.c.patient_id == Patient.id)
    if q:
        stmt = stmt.where(or_(func.lower(Patient.full_name).like(f"%{q.lower()}%"), Patient.phone.like(f"%{q}%")))
    rows = ctx.db.execute(stmt.order_by(last.c.last_at.desc()).limit(200)).all()
    out = []
    for p, last_at, n in rows:
        m = ctx.db.scalar(select(WhatsAppMessage).where(WhatsAppMessage.patient_id == p.id)
                          .order_by(WhatsAppMessage.occurred_at.desc(), WhatsAppMessage.created_at.desc()).limit(1))
        awaiting = ctx.db.scalar(select(func.count()).select_from(ReminderSchedule).where(
            ReminderSchedule.patient_id == p.id, ReminderSchedule.status == ReminderStatus.sent, ReminderSchedule.response.is_(None)))
        out.append({"patient": ser.patient_brief(p), "last_at": last_at.isoformat(), "count": n,
                    "last_message": {"body": m.body[:120], "direction": m.direction.value, "status": m.status.value} if m else None,
                    "awaiting_reply": bool(awaiting)})
    mode = outbound.get_config(ctx.db, ctx.hospital).mode.value
    return {"items": out, "mode": mode, "hospital": {"name": ctx.hospital.name, "phone": ctx.hospital.phone}}


@router.get("/conversations/{patient_id}")
def conversation(patient_id: uuid.UUID, ctx: Ctx = Depends(require("messages.view"))):
    p = owned(ctx.db.get(Patient, patient_id), ctx, "Patient")
    msgs = ctx.db.scalars(select(WhatsAppMessage).where(WhatsAppMessage.patient_id == p.id)
                          .order_by(WhatsAppMessage.occurred_at, WhatsAppMessage.created_at)).all()
    reminder_ids = {m.reminder_id for m in msgs if m.reminder_id}
    rems = {r.id: r for r in ctx.db.scalars(select(ReminderSchedule).where(ReminderSchedule.id.in_(reminder_ids or {uuid.uuid4()})))}
    items = []
    for m in msgs:
        d = ser.message(m)
        r = rems.get(m.reminder_id) if m.reminder_id else None
        d["reminder_response"] = r.response.value if r and r.response else None
        d["answerable"] = bool(m.is_simulated and m.direction.value == "outbound" and m.kind == "template" and r and not r.response)
        items.append(d)
    return {"patient": ser.patient_brief(p), "messages": items, "mode": outbound.get_config(ctx.db, ctx.hospital).mode.value}


@router.post("/simulate-tap")
def simulate_tap(body: SimulateTapIn, ctx: Ctx = Depends(require("messages.view", "appointments.manage"))):
    """Simulator only: acts as the patient tapping a button on a *simulated* reminder."""
    msg = owned(ctx.db.get(WhatsAppMessage, body.message_id), ctx, "Message")
    result = inbound.simulate_tap(ctx.db, ctx.hospital, msg, body.action)
    audit.record(ctx.db, "whatsapp.simulated_tap", hospital_id=ctx.hospital.id, user_id=ctx.user.id,
                 entity_type="message", entity_id=msg.id, details={"action": body.action, "result": result.get("result")})
    ctx.db.commit()
    return result


@router.get("")
def message_log(ctx: Ctx = Depends(require("messages.view")), status: list[MessageStatus] = Query(default=[]),
                page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    stmt = select(WhatsAppMessage).where(WhatsAppMessage.hospital_id == ctx.hospital.id)
    if status:
        stmt = stmt.where(WhatsAppMessage.status.in_(status))
    total = ctx.db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = ctx.db.scalars(stmt.order_by(WhatsAppMessage.occurred_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    names = {p.id: p.full_name for p in ctx.db.scalars(select(Patient).where(Patient.id.in_({m.patient_id for m in rows if m.patient_id} or {uuid.uuid4()})))}
    return {"items": [{**ser.message(m), "patient_name": names.get(m.patient_id)} for m in rows], "total": total}


@router.get("/reminders/failed")
def failed_reminders(ctx: Ctx = Depends(require("messages.view"))):
    rows = ctx.db.execute(select(ReminderSchedule, Patient).join(Patient, Patient.id == ReminderSchedule.patient_id)
                          .where(ReminderSchedule.hospital_id == ctx.hospital.id, ReminderSchedule.status == ReminderStatus.failed)
                          .order_by(ReminderSchedule.scheduled_for.desc()).limit(100)).all()
    return [{**ser.reminder(r), "patient": ser.patient_brief(p)} for r, p in rows]


@router.post("/reminders/{reminder_id}/retry")
def retry(reminder_id: uuid.UUID, body: RetryIn, ctx: Ctx = Depends(require("messages.retry"))):
    r = owned(ctx.db.get(ReminderSchedule, reminder_id), ctx, "Reminder")
    dispatcher.retry(ctx.db, ctx.hospital, r, confirm_uncertain=body.confirm_uncertain)
    audit.record(ctx.db, "reminder.retry", hospital_id=ctx.hospital.id, user_id=ctx.user.id, entity_type="reminder", entity_id=r.id)
    ctx.db.commit()
    dispatcher.run_cycle(ctx.db, ctx.hospital)
    ctx.db.refresh(r)
    return ser.reminder(r)
