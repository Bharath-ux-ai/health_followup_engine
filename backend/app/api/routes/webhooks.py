"""Meta WhatsApp Cloud API webhook: subscription verification (GET) and signed event delivery (POST)."""
import hmac
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.services.whatsapp import inbound

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
log = logging.getLogger("tectha.webhook")


@router.get("/whatsapp", response_class=PlainTextResponse)
def verify(mode: str = Query(alias="hub.mode"), token: str = Query(alias="hub.verify_token"),
           challenge: str = Query(alias="hub.challenge")):
    expected = get_settings().WHATSAPP_VERIFY_TOKEN
    if mode == "subscribe" and expected and hmac.compare_digest(token, expected):
        return challenge
    raise HTTPException(403, "Verification failed")


@router.post("/whatsapp")
async def receive(request: Request, db: Session = Depends(get_db)):
    raw = await request.body()
    if len(raw) > 1_000_000:
        raise HTTPException(413, "Payload too large")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Invalid JSON")
    signature = request.headers.get("x-hub-signature-256")
    if not any(inbound.signature_valid(raw, signature, s) for s in inbound.candidate_secrets(db, payload)):
        log.warning("Rejected WhatsApp webhook with invalid signature")
        raise HTTPException(401, "Invalid signature")
    summary = inbound.process_webhook(db, payload)
    return {"ok": True, **summary}
