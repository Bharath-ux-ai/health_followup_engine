"""Demo control panel API. Every call is refused unless DEMO_MODE is on AND the caller's hospital is a demo hospital."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import Ctx, owned, require
from app.core.config import get_settings
from app.models import FollowUp
from app.schemas import serializers as ser
from app.schemas.requests import DemoClockIn
from app.services import audit, clock, demo, views

router = APIRouter(prefix="/demo", tags=["demo"])


def demo_ctx(ctx: Ctx = Depends(require("hospital.demo.control"))) -> Ctx:
    if not get_settings().DEMO_MODE or not ctx.hospital.is_demo:
        raise HTTPException(403, "Demo controls are only available for the demo hospital")
    return ctx


def _state(ctx: Ctx) -> dict:
    return {"hospital": ser.hospital(ctx.hospital), "now": clock.local_now(ctx.hospital).isoformat(),
            "demo_clock": clock.demo_clock_active(ctx.hospital), "scenario": demo.scenario(ctx.db, ctx.hospital)}


@router.get("/state")
def state(ctx: Ctx = Depends(demo_ctx)):
    return _state(ctx)


@router.post("/clock")
def set_clock(body: DemoClockIn, ctx: Ctx = Depends(demo_ctx)):
    h = ctx.hospital
    if body.reset_to_real:
        demo.reset_clock_to_real(ctx.db, h)
    elif body.set_to:
        try:
            demo.set_clock(ctx.db, h, datetime.fromisoformat(body.set_to))
        except ValueError:
            raise HTTPException(422, "Use the format YYYY-MM-DDTHH:MM")
    elif body.advance_days or body.advance_hours:
        demo.advance(ctx.db, h, days=body.advance_days or 0, hours=body.advance_hours or 0)
    audit.record(ctx.db, "demo.clock", hospital_id=h.id, user_id=ctx.user.id, details={"now": clock.local_now(h).isoformat()})
    ctx.db.commit()
    return _state(ctx)


@router.post("/run-reminders")
def run_reminders(ctx: Ctx = Depends(demo_ctx)):
    totals = demo.run_reminders(ctx.db, ctx.hospital)
    ctx.db.commit()
    return {"totals": totals, **_state(ctx)}


class ResetIn(BaseModel):
    with_samples: bool = True


@router.post("/reset")
def reset(body: ResetIn, ctx: Ctx = Depends(demo_ctx)):
    result = demo.reset(ctx.db, ctx.hospital, with_samples=body.with_samples, user_id=ctx.user.id)
    return {"result": result, **_state(ctx)}


@router.post("/load-samples")
def load_samples(ctx: Ctx = Depends(demo_ctx)):
    """Adds the sample journeys (patients, appointments, follow-ups) on top of a cleared demo."""
    return reset(ResetIn(with_samples=True), ctx)


class RaviIn(BaseModel):
    phone: str | None = Field(None, max_length=20)


@router.post("/ravi/book")
def book_ravi(body: RaviIn, ctx: Ctx = Depends(demo_ctx)):
    appt = demo.book_ravi(ctx.db, ctx.hospital, body.phone)
    ctx.db.commit()
    return {"appointment": views.appointments_out(ctx.db, [appt])[0], **_state(ctx)}


@router.post("/followups/{followup_id}/no-response")
def no_response(followup_id: uuid.UUID, ctx: Ctx = Depends(demo_ctx)):
    fu = owned(ctx.db.get(FollowUp, followup_id), ctx, "Follow-up")
    demo.simulate_no_response(ctx.db, ctx.hospital, fu)
    ctx.db.commit()
    return _state(ctx)
