import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.routes import admin, appointments, auth, demo, followups, insights, messages, patients, public, system, webhooks
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.errors import DomainError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("tectha")


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = threading.Event()
    if get_settings().RUN_WORKER_IN_API:
        from app.worker import loop
        threading.Thread(target=loop, args=(stop,), daemon=True, name="reminder-worker").start()
        log.info("Reminder worker running inside the API process")
    yield
    stop.set()


settings = get_settings()
app = FastAPI(title=settings.APP_NAME, version="1.0.0", lifespan=lifespan,
              docs_url=None if settings.is_production else "/api/docs", openapi_url=None if settings.is_production else "/api/openapi.json")

if settings.CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ORIGINS, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/") and request.url.path not in ("/api/docs", "/api/openapi.json"):
        response.headers.setdefault("Cache-Control", "no-store")  # patient data must not be cached
    if settings.is_production:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


@app.exception_handler(DomainError)
async def domain_error(request: Request, exc: DomainError):
    return JSONResponse({"detail": exc.message, "code": exc.code}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    first = errors[0] if errors else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
    msg = str(first.get("msg", "Invalid input")).removeprefix("Value error, ")
    return JSONResponse({"detail": f"{field.replace('_', ' ')}: {msg}", "code": "invalid_input",
                         "errors": [{"loc": e.get("loc"), "msg": e.get("msg")} for e in errors]}, status_code=422)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Something went wrong. Please try again.", "code": "server_error"}, status_code=500)


for r in (auth, public, appointments, patients, followups, insights, messages, admin, webhooks, system, demo):
    app.include_router(r.router, prefix="/api")


@app.get("/api/health")
def health():
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {"status": "ok"}
