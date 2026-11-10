# One-command local demo (Windows PowerShell). Needs Python 3.11+ and Node.js 20.9+.
# Run:  powershell -ExecutionPolicy Bypass -File .\start-demo.ps1
# Uses a local SQLite database — for a real deployment use Docker + PostgreSQL (see README).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$DemoPassword = if ($env:DEMO_PASSWORD) { $env:DEMO_PASSWORD } else { "TecThaDemo2026" }

Write-Host "> Backend setup"
Set-Location backend
if (-not (Test-Path .venv)) { if (Get-Command py -ErrorAction SilentlyContinue) { py -3 -m venv .venv } else { python -m venv .venv } }
$py = "python"
try {
  if (Test-Path .\.venv\Scripts\python.exe) {
    & .\.venv\Scripts\python.exe -c "import pydantic_core" 2>$null
    if ($LASTEXITCODE -eq 0) { $py = ".\.venv\Scripts\python.exe" }
  }
} catch {
  $py = "python"
}
& $py -m pip install -q --upgrade pip
& $py -m pip install -q -r requirements.txt
if (-not (Test-Path .env)) {
  & $py -c @"
import secrets
from cryptography.fernet import Fernet
open('.env', 'w').write(f'''ENVIRONMENT=development
DATABASE_URL=sqlite:///./tectha-demo.db
SECRET_KEY={secrets.token_urlsafe(48)}
ENCRYPTION_KEY={Fernet.generate_key().decode()}
COOKIE_SECURE=false
DEMO_MODE=true
DEMO_PASSWORD=$DemoPassword
RUN_WORKER_IN_API=true
PUBLIC_APP_URL=http://localhost:3000
WHATSAPP_VERIFY_TOKEN={secrets.token_urlsafe(16)}
''')
print('  created backend/.env')
"@
}
& $py -m alembic upgrade head
$env:DEMO_PASSWORD = $DemoPassword
& $py -m scripts.seed_demo
$api = Start-Process -FilePath $py -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000" -PassThru -NoNewWindow -RedirectStandardOutput ..\api.log -RedirectStandardError ..\api-err.log
Set-Location ..

Write-Host "> Frontend build (first run takes a minute)"
if (-not (Test-Path node_modules)) { npm ci }
npm run build
if ($LASTEXITCODE -ne 0) { Stop-Process -Id $api.Id; throw "Frontend build failed" }
Write-Host ""
Write-Host "Ready:  http://localhost:3000"
Write-Host "  Hospital admin  admin@tectha-demo.in    / $DemoPassword"
Write-Host "  Reception staff staff@tectha-demo.in    / $DemoPassword"
Write-Host "  System admin    platform@tectha-demo.in / $DemoPassword"
Write-Host "  Public booking  http://localhost:3000/book/tectha-clinic"
try { npx next start -p 3000 } finally { Stop-Process -Id $api.Id -ErrorAction SilentlyContinue }
