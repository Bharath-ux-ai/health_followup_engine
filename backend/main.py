"""Vercel / Serverless & standalone entrypoint for TEC THA Follow-Up Engine.
Automatically sets up demo defaults and copies the pre-seeded SQLite database to temp
when running in a read-only serverless environment like Vercel.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
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

# If running on Vercel or read-only environment:
# Copy the pre-seeded SQLite DB to temp dir so writes succeed
is_serverless = os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
tmp_db = Path(tempfile.gettempdir()) / "tectha-demo.db"
seed_db = BACKEND_DIR / "tectha-demo.db"

if is_serverless:
    if not tmp_db.exists() and seed_db.exists():
        try:
            tmp_db.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(seed_db), str(tmp_db))
        except Exception as err:
            print(f"[Vercel Init] Failed copying seed db: {err}")
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_db.as_posix()}"
else:
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{seed_db.as_posix()}")

from app.main import app  # noqa: E402

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
