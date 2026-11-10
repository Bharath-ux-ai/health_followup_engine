"""Reminder worker: `python -m app.worker`. Safe to run several copies (reminders are claimed atomically)."""
import logging
import signal
import threading

from app.core.config import get_settings
from app.db.base import utcnow
from app.db.session import SessionLocal
from app.models import SystemSetting
from app.services import dispatcher

log = logging.getLogger("tectha.worker")


def run_once() -> dict:
    with SessionLocal() as db:
        totals = dispatcher.run_cycle(db)
        hb = db.get(SystemSetting, "worker_heartbeat") or SystemSetting(key="worker_heartbeat", value={})
        hb.value = {"at": utcnow().isoformat(), "totals": totals}
        db.add(hb)
        db.commit()
        return totals


def loop(stop: threading.Event) -> None:
    interval = get_settings().WORKER_INTERVAL_SECONDS
    while not stop.is_set():
        try:
            totals = run_once()
            if any(totals.values()):
                log.info("reminder cycle: %s", totals)
        except Exception:  # noqa: BLE001 — keep the worker alive, but never silently
            log.exception("reminder cycle failed")
        stop.wait(interval)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    log.info("worker started (interval %ss)", get_settings().WORKER_INTERVAL_SECONDS)
    loop(stop)
    log.info("worker stopped")


if __name__ == "__main__":
    main()
