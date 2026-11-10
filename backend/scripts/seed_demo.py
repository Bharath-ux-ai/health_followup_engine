"""Create the demo hospital (TEC THA Multispeciality Clinic) and load fictional sample data.

Requires DEMO_MODE=true and DEMO_PASSWORD in the environment. Never run against a production database.
Usage: python -m scripts.seed_demo [--no-samples]
"""
import argparse
import os

from app.core.config import get_settings
from app.core.permissions import SYSTEM_ADMIN
from app.db.session import SessionLocal
from app.models import User
from app.services import demo, onboarding
from sqlalchemy import select


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-samples", action="store_true")
    args = ap.parse_args()
    if not get_settings().DEMO_MODE:
        raise SystemExit("DEMO_MODE is not enabled — refusing to create demo data.")
    with SessionLocal() as db:
        onboarding.ensure_roles(db)
        h = demo.ensure_demo_hospital(db)
        db.commit()
        result = demo.reset(db, h, with_samples=not args.no_samples)
        sysadmin_email = os.environ.get("DEMO_SYSADMIN_EMAIL", "platform@tectha-demo.in")
        if not db.scalar(select(User).where(User.email == sysadmin_email)):
            onboarding.create_user(db, email=sysadmin_email, full_name="Platform Admin",
                                   password=os.environ["DEMO_PASSWORD"], role_code=SYSTEM_ADMIN, hospital=None)
            db.commit()
        print(f"Demo hospital ready: {h.name} (/book/{h.slug}) — {result}")
        print("Sign in as admin@tectha-demo.in, staff@tectha-demo.in or", sysadmin_email, "with DEMO_PASSWORD")


if __name__ == "__main__":
    main()
