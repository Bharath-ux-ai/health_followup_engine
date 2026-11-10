import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select

from app.api.deps import Ctx, owned, require
from app.models import FollowUp, FollowUpContact, Patient, User
from app.models.enums import OPEN_FOLLOWUP_STATUSES, FollowUpStatus
from app.schemas import serializers as ser
from app.schemas.requests import ContactIn, FollowUpBookIn, FollowUpDateIn, FollowUpStatusIn
from app.services import clock, followups, views

router = APIRouter(prefix="/followups", tags=["followups"])


@router.get("")
def list_followups(
    ctx: Ctx = Depends(require("followups.view")), view: str = Query("all", pattern="^(all|attention|upcoming|missed|completed)$"),
    status: list[FollowUpStatus] = Query(default=[]), date_from: date | None = None, date_to: date | None = None,
    q: str | None = Query(None, max_length=80), page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
):
    h = ctx.hospital
    if view == "attention":
        items = views.attention_followups(ctx.db, h, limit=500)
        return {"items": items, "total": len(items), "page": 1, "page_size": len(items)}
    today = clock.today(h)
    stmt = select(FollowUp).join(Patient, Patient.id == FollowUp.patient_id).where(FollowUp.hospital_id == h.id)
    if view == "upcoming":
        stmt = stmt.where(FollowUp.status.in_(OPEN_FOLLOWUP_STATUSES), FollowUp.due_date >= today)
    elif view == "missed":
        stmt = stmt.where(FollowUp.status == FollowUpStatus.missed)
    elif view == "completed":
        stmt = stmt.where(FollowUp.status == FollowUpStatus.completed)
    if status:
        stmt = stmt.where(FollowUp.status.in_(status))
    if date_from:
        stmt = stmt.where(FollowUp.due_date >= date_from)
    if date_to:
        stmt = stmt.where(FollowUp.due_date <= date_to)
    if q:
        digits = "".join(c for c in q if c.isdigit())
        conds = [func.lower(Patient.full_name).like(f"%{q.strip().lower()}%")]
        if len(digits) >= 4:
            conds.append(Patient.phone.like(f"%{digits}%"))
        stmt = stmt.where(or_(*conds))
    total = ctx.db.scalar(select(func.count()).select_from(stmt.subquery()))
    order = FollowUp.due_date.desc() if view in ("completed", "missed") else FollowUp.due_date
    rows = ctx.db.scalars(stmt.order_by(order).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": views.followups_out(ctx.db, h, list(rows)), "total": total, "page": page, "page_size": page_size}


@router.get("/summary")
def summary(ctx: Ctx = Depends(require("followups.view"))):
    h = ctx.hospital
    today = clock.today(h)
    attention = views.attention_followups(ctx.db, h, limit=500)
    count = lambda *w: ctx.db.scalar(select(func.count()).select_from(FollowUp).where(FollowUp.hospital_id == h.id, *w)) or 0  # noqa: E731
    return {
        "unconfirmed": sum(a["attention"] == "unconfirmed" for a in attention),
        "overdue": sum(a["attention"] == "overdue" for a in attention),
        "upcoming_7d": count(FollowUp.status.in_(OPEN_FOLLOWUP_STATUSES), FollowUp.due_date >= today, FollowUp.due_date <= today + timedelta(days=7)),
        "confirmed": count(FollowUp.status.in_([FollowUpStatus.confirmed, FollowUpStatus.rescheduled]), FollowUp.due_date >= today),
        "completed": count(FollowUp.status == FollowUpStatus.completed),
    }


def _one(ctx: Ctx, followup_id: uuid.UUID) -> FollowUp:
    return owned(ctx.db.get(FollowUp, followup_id), ctx, "Follow-up")


def _out(ctx: Ctx, fu: FollowUp) -> dict:
    out = views.followups_out(ctx.db, ctx.hospital, [fu])[0]
    rows = ctx.db.execute(select(FollowUpContact, User.full_name).outerjoin(User, User.id == FollowUpContact.user_id)
                          .where(FollowUpContact.followup_id == fu.id).order_by(FollowUpContact.contacted_at.desc())).all()
    out["contacts"] = [ser.contact(c, by) for c, by in rows]
    return out


@router.get("/{followup_id}")
def detail(followup_id: uuid.UUID, ctx: Ctx = Depends(require("followups.view"))):
    return _out(ctx, _one(ctx, followup_id))


@router.patch("/{followup_id}")
def change_date(followup_id: uuid.UUID, body: FollowUpDateIn, ctx: Ctx = Depends(require("followups.manage"))):
    fu = followups.change_date(ctx.db, ctx.hospital, _one(ctx, followup_id), body.due_date, user_id=ctx.user.id)
    ctx.db.commit()
    return _out(ctx, fu)


@router.post("/{followup_id}/status")
def set_status(followup_id: uuid.UUID, body: FollowUpStatusIn, ctx: Ctx = Depends(require("followups.manage"))):
    fu = followups.set_status(ctx.db, ctx.hospital, _one(ctx, followup_id), FollowUpStatus(body.status), user_id=ctx.user.id)
    ctx.db.commit()
    return _out(ctx, fu)


@router.post("/{followup_id}/book")
def book_visit(followup_id: uuid.UUID, body: FollowUpBookIn, ctx: Ctx = Depends(require("followups.manage", "appointments.manage"))):
    """Staff books the return visit (e.g. after a phone call)."""
    fu = _one(ctx, followup_id)
    followups.book_visit(ctx.db, ctx.hospital, fu, body.date, body.start_time, via="staff", user_id=ctx.user.id)
    ctx.db.commit()
    return _out(ctx, fu)


@router.post("/{followup_id}/contact", status_code=201)
def contact(followup_id: uuid.UUID, body: ContactIn, ctx: Ctx = Depends(require("followups.manage"))):
    fu = _one(ctx, followup_id)
    followups.log_contact(ctx.db, ctx.hospital, fu, body.outcome, body.note, user_id=ctx.user.id)
    ctx.db.commit()
    return _out(ctx, fu)
