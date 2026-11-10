#!/usr/bin/env bash
# One-command local demo (macOS / Linux). Needs Python 3.11+ and Node.js 20.9+.
# Uses a local SQLite database — for a real deployment use Docker + PostgreSQL (see README).
set -euo pipefail
cd "$(dirname "$0")"
DEMO_PASSWORD="${DEMO_PASSWORD:-TecThaDemo2026}"
PY="${PYTHON:-python3}"

echo "▶ Backend setup"
cd backend
[ -d .venv ] || "$PY" -m venv .venv
. .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
if [ ! -f .env ]; then
  python - <<PYEOF
import secrets
from cryptography.fernet import Fernet
open(".env", "w").write(f"""ENVIRONMENT=development
DATABASE_URL=sqlite:///./tectha-demo.db
SECRET_KEY={secrets.token_urlsafe(48)}
ENCRYPTION_KEY={Fernet.generate_key().decode()}
COOKIE_SECURE=false
DEMO_MODE=true
DEMO_PASSWORD=$DEMO_PASSWORD
RUN_WORKER_IN_API=true
PUBLIC_APP_URL=http://localhost:3000
WHATSAPP_VERIFY_TOKEN={secrets.token_urlsafe(16)}
""")
print("  created backend/.env")
PYEOF
fi
alembic upgrade head
DEMO_PASSWORD="$DEMO_PASSWORD" python -m scripts.seed_demo
uvicorn app.main:app --host 127.0.0.1 --port 8000 > ../api.log 2>&1 &
API_PID=$!
cd ..

echo "▶ Frontend build (first run takes a minute)"
[ -d node_modules ] || npm ci
npm run build > ../web-build.log 2>&1 || { echo "Frontend build failed — see web-build.log"; kill $API_PID; exit 1; }
trap 'kill $API_PID 2>/dev/null' EXIT
echo
echo "✔ Ready:  http://localhost:3000"
echo "  Hospital admin  admin@tectha-demo.in    / $DEMO_PASSWORD"
echo "  Reception staff staff@tectha-demo.in    / $DEMO_PASSWORD"
echo "  System admin    platform@tectha-demo.in / $DEMO_PASSWORD"
echo "  Public booking  http://localhost:3000/book/tectha-clinic"
echo "  (Ctrl+C to stop)"
npx next start -p 3000
