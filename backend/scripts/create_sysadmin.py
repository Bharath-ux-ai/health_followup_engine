"""Create (or reset) a platform System Admin.

Usage: python -m scripts.create_sysadmin --email ops@tectha.in --name "Platform Admin"
The password is read from SYSADMIN_PASSWORD or prompted for; it is never stored in code.
"""
import argparse
import getpass
import os

from sqlalchemy import select

from app.core.permissions import SYSTEM_ADMIN
from app.core.security import hash_password, validate_password_strength
from app.db.session import SessionLocal
from app.models import User
from app.services import onboarding


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--name", default="Platform Admin")
    args = ap.parse_args()
    password = os.environ.get("SYSADMIN_PASSWORD") or getpass.getpass("Password (min 10 chars, letters + numbers): ")
    validate_password_strength(password)
    with SessionLocal() as db:
        onboarding.ensure_roles(db)
        user = db.scalar(select(User).where(User.email == args.email.lower()))
        if user:
            user.password_hash, user.token_version = hash_password(password), user.token_version + 1
            print(f"Updated password for {user.email}")
        else:
            onboarding.create_user(db, email=args.email, full_name=args.name, password=password, role_code=SYSTEM_ADMIN, hospital=None)
            print(f"Created system admin {args.email.lower()}")
        db.commit()


if __name__ == "__main__":
    main()
