"""Vercel Serverless Function entry point for FastAPI backend.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

# Add backend directory to sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Ensure demo environment settings
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("RUN_WORKER_IN_API", "false")
os.environ.setdefault("SECRET_KEY", "tectha-demo-secret-key-32-chars-long-min-len!!")
os.environ.setdefault("ENCRYPTION_KEY", "bXl0ZXN0ZW5jcnlwdGlvbmtleWZvcmRlbW9wdXJwb3NlczE=")
os.environ.setdefault("PUBLIC_APP_URL", "http://localhost:3000")

# If running on Vercel or read-only / serverless environment:
# Copy the pre-seeded SQLite DB to a writable temp dir so writes succeed
tmp_db = Path(tempfile.gettempdir()) / "tectha-demo.db"
seed_db = BACKEND_DIR / "tectha-demo.db"

if not tmp_db.exists() and seed_db.exists():
    try:
        tmp_db.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(seed_db), str(tmp_db))
    except Exception as err:
        print(f"[Vercel Init] Failed copying seed db to temp: {err}")

if tmp_db.exists():
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_db.as_posix()}"
else:
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{seed_db.as_posix()}")

from app.main import app  # noqa: E402
