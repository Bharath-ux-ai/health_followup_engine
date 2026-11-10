"""WhatsApp transport adapters.

CloudApiProvider talks to Meta's WhatsApp Business Platform Cloud API (graph.facebook.com).
SimulationProvider never leaves the server — messages are recorded with status "simulated" and shown only in the
in-app conversation simulator. A message is only ever marked "sent" when the Cloud API returned a message id.
"""
from dataclasses import dataclass, field

import httpx

from app.core.config import get_settings

# Cloud API error codes worth retrying automatically (throttling / transient platform errors).
RETRYABLE_CODES = {"4", "80007", "130429", "131000", "131016", "131056", "133004"}


@dataclass
class SendResult:
    ok: bool
    simulated: bool = False
    wamid: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = False
    uncertain: bool = False  # request may have reached Meta (timeout after sending) — do not auto-retry
    raw: dict = field(default_factory=dict)


class SimulationProvider:
    name = "simulation"

    def send_template(self, to: str, meta_name: str, lang_code: str, params: list[str], payloads: list[str]) -> SendResult:
        return SendResult(ok=True, simulated=True)

    def send_text(self, to: str, text: str) -> SendResult:
        return SendResult(ok=True, simulated=True)


class CloudApiProvider:
    name = "cloud_api"

    def __init__(self, phone_number_id: str, access_token: str, *, transport: httpx.BaseTransport | None = None):
        s = get_settings()
        self.phone_number_id = phone_number_id
        self._client = httpx.Client(
            base_url=f"{s.WHATSAPP_GRAPH_BASE_URL}/{s.WHATSAPP_API_VERSION}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=s.WHATSAPP_HTTP_TIMEOUT_SECONDS,
            transport=transport,
        )

    # ---- sending ------------------------------------------------------------
    def send_template(self, to: str, meta_name: str, lang_code: str, params: list[str], payloads: list[str]) -> SendResult:
        components: list[dict] = []
        if params:
            components.append({"type": "body", "parameters": [{"type": "text", "text": p} for p in params]})
        for i, payload in enumerate(payloads):
            components.append({"type": "button", "sub_type": "quick_reply", "index": str(i),
                               "parameters": [{"type": "payload", "payload": payload}]})
        return self._send({
            "messaging_product": "whatsapp", "recipient_type": "individual", "to": to, "type": "template",
            "template": {"name": meta_name, "language": {"code": lang_code}, "components": components},
        })

    def send_text(self, to: str, text: str) -> SendResult:
        return self._send({"messaging_product": "whatsapp", "recipient_type": "individual", "to": to, "type": "text",
                           "text": {"preview_url": True, "body": text}})

    def _send(self, body: dict) -> SendResult:
        try:
            resp = self._client.post(f"/{self.phone_number_id}/messages", json=body)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
            return SendResult(ok=False, error_code="network", error_message=f"Could not reach WhatsApp: {exc}", retryable=True)
        except httpx.TimeoutException as exc:
            return SendResult(ok=False, error_code="timeout", uncertain=True,
                              error_message=f"No response from WhatsApp ({exc.__class__.__name__}); delivery unknown")
        return self._parse(resp)

    @staticmethod
    def _parse(resp: httpx.Response) -> SendResult:
        try:
            data = resp.json()
        except ValueError:
            data = {}
        if resp.status_code == 200 and data.get("messages"):
            return SendResult(ok=True, wamid=data["messages"][0]["id"], raw=data)
        err = data.get("error", {}) if isinstance(data, dict) else {}
        code = str(err.get("code", resp.status_code))
        detail = (err.get("error_data") or {}).get("details") or err.get("message") or f"HTTP {resp.status_code}"
        return SendResult(ok=False, error_code=code, error_message=str(detail)[:400], raw=data,
                          retryable=resp.status_code >= 500 or resp.status_code == 429 or code in RETRYABLE_CODES)

    # ---- account helpers ------------------------------------------------------
    def verify(self) -> dict:
        resp = self._client.get(f"/{self.phone_number_id}", params={"fields": "display_phone_number,verified_name,quality_rating"})
        if resp.status_code != 200:
            err = resp.json().get("error", {}) if resp.headers.get("content-type", "").startswith("application/json") else {}
            raise RuntimeError(err.get("message") or f"HTTP {resp.status_code}")
        return resp.json()

    def list_templates(self, waba_id: str) -> list[dict]:
        out, url, params = [], f"/{waba_id}/message_templates", {"fields": "name,language,status", "limit": 100}
        while url:
            resp = self._client.get(url, params=params)
            if resp.status_code != 200:
                raise RuntimeError(resp.json().get("error", {}).get("message") or f"HTTP {resp.status_code}")
            data = resp.json()
            out.extend(data.get("data", []))
            url = (data.get("paging") or {}).get("next")
            params = None
        return out
