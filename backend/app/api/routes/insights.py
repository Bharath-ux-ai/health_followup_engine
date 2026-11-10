"""Dashboard and monthly reports."""
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select

from app.api.deps import Ctx, require
from app.models import MonthlyReport
from app.services import audit, clock, reports, views

router = APIRouter(tags=["insights"])


@router.get("/dashboard")
def dashboard(ctx: Ctx = Depends(require("appointments.view")), on: date | None = Query(None, alias="date")):
    return views.dashboard(ctx.db, ctx.hospital, on)


def _period(ctx: Ctx, year: int | None, month: int | None) -> tuple[int, int]:
    today = clock.today(ctx.hospital)
    return year or today.year, month or today.month


@router.get("/reports/monthly")
def monthly(ctx: Ctx = Depends(require("hospital.reports.view")), year: int | None = Query(None, ge=2020, le=2100),
            month: int | None = Query(None, ge=1, le=12)):
    y, m = _period(ctx, year, month)
    return reports.monthly(ctx.db, ctx.hospital, y, m)


@router.get("/reports/monthly.csv")
def monthly_csv(ctx: Ctx = Depends(require("hospital.reports.view")), year: int | None = Query(None, ge=2020, le=2100),
                month: int | None = Query(None, ge=1, le=12)):
    y, m = _period(ctx, year, month)
    data = reports.monthly(ctx.db, ctx.hospital, y, m, with_trend=False)
    audit.record(ctx.db, "report.exported", hospital_id=ctx.hospital.id, user_id=ctx.user.id, details={"year": y, "month": m})
    ctx.db.commit()
    filename = f"tectha-report-{ctx.hospital.slug}-{y}-{m:02d}.csv"
    return Response("﻿" + reports.to_csv(data), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/reports/monthly/snapshot")
def snapshot(ctx: Ctx = Depends(require("hospital.reports.view")), year: int | None = Query(None, ge=2020, le=2100),
             month: int | None = Query(None, ge=1, le=12)):
    """Freeze the month's figures (e.g. when sending the report to the hospital owner)."""
    y, m = _period(ctx, year, month)
    data = reports.monthly(ctx.db, ctx.hospital, y, m, with_trend=False)
    row = ctx.db.scalar(select(MonthlyReport).where(MonthlyReport.hospital_id == ctx.hospital.id,
                                                    MonthlyReport.year == y, MonthlyReport.month == m))
    if row is None:
        row = MonthlyReport(hospital_id=ctx.hospital.id, year=y, month=m)
        ctx.db.add(row)
    row.metrics, row.generated_at, row.generated_by_user_id = data, clock.now(ctx.hospital), ctx.user.id
    ctx.db.commit()
    return {"ok": True, "generated_at": row.generated_at.isoformat()}


@router.get("/reports/snapshots")
def snapshots(ctx: Ctx = Depends(require("hospital.reports.view"))):
    rows = ctx.db.scalars(select(MonthlyReport).where(MonthlyReport.hospital_id == ctx.hospital.id)
                          .order_by(MonthlyReport.year.desc(), MonthlyReport.month.desc())).all()
    return [{"year": r.year, "month": r.month, "generated_at": r.generated_at.isoformat(),
             "summary": r.metrics.get("summary")} for r in rows]
