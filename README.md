# TEC THA Follow-Up Engine — Version 1

Appointment booking and WhatsApp follow-up reminders for hospitals and clinics, built to the *TEC THA Follow-Up Engine – Version 1 Brief*: a shareable booking link, day-before reminders with **Confirm / Reschedule**, follow-up reminders **7 and 3 days** before, a dashboard that shows missed follow-ups **in red**, and a monthly report — *"We brought back X patients this month."*

Out of scope for V1 (per the brief): AI assistant, public patient app, billing, health records. No medical information is collected.

---

## 1. Quick start — local demo on a laptop

Needs **Python 3.11+** and **Node.js 20.9+**. Uses SQLite, so no database server is required.

```bash
# macOS / Linux
./start-demo.sh
```
```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File .\start-demo.ps1
```

Open **http://localhost:3000**. The first run installs dependencies and builds the UI (≈2 minutes).

| Account | Email | Password |
|---|---|---|
| Hospital admin | `admin@tectha-demo.in` | `TecThaDemo2026` (or `DEMO_PASSWORD`) |
| Reception staff | `staff@tectha-demo.in` | same |
| System admin | `platform@tectha-demo.in` | same |

Public booking page: **http://localhost:3000/book/tectha-clinic**

Screenshots of every screen, captured by the automated browser run of the demo, are in [`docs/screenshots`](docs/screenshots).

The demo hospital is **TEC THA Multispeciality Clinic, Coimbatore** with Dr. Arun Kumar (General Physician), Dr. Priya (Dermatologist) and Dr. Karthik (Cardiologist), plus 12 clearly-badged fictional patients. Their history is produced by replaying patient journeys through the real engine (bookings → reminders → replies → visits), so every dashboard and report figure is genuine engine output. Fictional patients are **never** messaged — their WhatsApp messages are always simulated.

---

## 2. Hospital-owner demo (5–10 minutes)

Sign in as the hospital admin and open **Demo Control**. The demo clock (Asia/Kolkata) starts on **Monday 9 November 2026, 9:00 AM**.

1. **Ask:** "Out of 10 follow-up patients, how many come back?"
2. **Book live as Mr. Ravi** — open the public booking link, pick Dr. Arun Kumar → Wednesday → 10:30 AM, enter "Ravi" and a number. (Or *Quick-book Ravi*.) Show the appointment ID and the new row on **Overview**.
3. **Tuesday evening reminder** — Demo Control → step 2 *Set clock* (Tue 6:05 PM, triggers reminders) → **WhatsApp Messages** → Ravi's chat shows the reminder from the hospital profile. Tap **Confirm** → status becomes *Confirmed* everywhere.
   *To send a real WhatsApp to the owner's own phone:* put the clinic in live mode (Settings → WhatsApp, §5) and book Ravi with the owner's number, with their consent.
4. **Wednesday visit** — step 3 → open the appointment → **Patient visited** → set the **follow-up date: 2 December**. The screen shows reminders on **25 Nov** and **29 Nov**.
5. **7-day and 3-day reminders** — steps 5 and 6 → show both messages in the chat.
6. **Patient responds** — tap **Confirm** (visit booked automatically at the same time on 2 Dec) **or Reschedule** (the patient's link opens, pick another slot; the original appointment moves, double booking is impossible).
7. **Alternate path — no response** — *Simulate no response* → **Overview** shows Ravi **in red** under *Needs a call*. Step 8 moves past the date → **Overdue**. Staff tap **Call** / **Contacted** and record the outcome, or **Book visit**.
8. **Monthly Reports** — "We brought back X patients this month." Export CSV or Print/PDF.
9. Offer the free 2-week pilot. (No free-consultation offers or fake reviews — NMC rules.)

**Reset & load sample data** in Demo Control restores the starting state for the next presentation.

Demo controls only work when `DEMO_MODE=true` **and** for hospitals flagged as demo; the demo clock is stored per demo hospital, so real hospitals on the same server are never affected. Production (`ENVIRONMENT=production`) refuses to start with demo mode on.

---

## 3. What's implemented

| Module | Highlights |
|---|---|
| **Appointment booking** | Hospital-specific shareable link `/book/<slug>`; doctor → date strip → live slots → name/phone/language/consent; unique ID (`TT-XXXXXX`, no ambiguous characters); confirmation screen. Reception booking screen. Double booking prevented by a database-level unique slot key (verified with 8 concurrent requests). Patients de-duplicated by phone + normalised name (family members sharing a phone stay separate). |
| **WhatsApp appointment reminders** | Day before the visit at the hospital's send time (default 6 PM IST); template with patient, hospital, doctor, date, time + **Confirm / Reschedule** quick-reply buttons; English & Tamil. Webhooks process button taps → appointment confirmed / reschedule link sent. Delivery tracking (sent → delivered → read, out-of-order safe), failure logging, automatic retry with backoff for transient errors, manual retry, "delivery uncertain" protection against duplicates, idempotent per visit date. |
| **Follow-up reminders** | Staff set the next date on the visit; reminders automatically 7 and 3 days before; short-notice and same-day boundaries handled (skip passed reminders, one catch-up, quiet hours 9 PM–8 AM); Confirm books the return visit in one tap (same time as the original visit if free); Reschedule sends a link to pick another date. Distinct states: *no response* (red), *overdue* (red, date passed with no visit), *confirmed*, *rescheduled*, *returned*. Staff contact log ("Mark as contacted"). |
| **Dashboard** | Today's appointments with status filter chips, confirmed / pending / cancelled counts, month totals, upcoming follow-ups, **Needs a call (red)**, reschedule requests, reminders sent, brought back; date navigation; search & filters on Appointments, Patients, Follow-ups; staff actions inline (confirm, visited, no-show, cancel, reschedule, book visit, call). Separate admin and reception variants. |
| **Monthly report** | Totals, completed, cancelled, missed, follow-ups scheduled/completed, return rate, returning-patient share, reminder stats; "We brought back X patients this month" counts only follow-ups **completed after a reminder was sent** (returns without a reminder are shown separately); daily chart, 6-month trend; CSV export, print/PDF, saved snapshots. |
| **Roles** | System admin (hospitals, onboarding, platform settings, status — **no patient access**), Hospital admin (everything for their hospital), Hospital staff (operations only). Roles/permissions are database tables. |
| **WhatsApp simulator** | WhatsApp-style patient view with hospital profile, buttons you can tap, reschedule slot picker; every simulated message is labelled "simulated — not sent via WhatsApp". |
| **Demo control panel** | Set/advance clock (+1 h, +1 day, +7 days), trigger reminders, guided Mr. Ravi stepper (success + no-response paths), simulate no response, quick-book, reset with or without sample data. |

### Security & privacy
bcrypt password hashing (cost 12), httpOnly SameSite session cookie + CSRF header check, session revocation (password change/reset, deactivation), login rate limiting and lockout, generic login errors, no account enumeration on reset; strict tenant isolation (every query scoped to the caller's hospital; other hospitals' records return 404); Pydantic validation with unknown fields rejected; WhatsApp tokens encrypted at rest (Fernet) and never returned; webhook HMAC-SHA256 signature validation; webhook and booking payload checks (a button payload is only honoured from the patient's own number); consent recorded with time and source before any message, `STOP` withdraws consent; audit log of sign-ins, record views, status changes and configuration changes (no phone numbers or secrets logged); `Cache-Control: no-store` on API responses; security headers; HSTS + automatic HTTPS via Caddy; nightly backups with retention and a restore script; the public booking page returns only free/taken times.

---

## 4. Architecture

```
Browser ──► Caddy (HTTPS) ──► Next.js 16 UI (TypeScript, Tailwind v4)        /
                        └───► FastAPI (Pydantic, SQLAlchemy 2, Alembic)     /api/*
                                   │            ▲
                                   ▼            │ webhooks (signed)
                              PostgreSQL 16   Meta WhatsApp Cloud API
                                   ▲
                    Reminder worker (python -m app.worker, every 30 s)
```

* **Reminder engine** — reminders are rows with an idempotency key (`kind:entity:target-date`). The worker claims each due row with a conditional update (`pending → processing`, plus `FOR UPDATE SKIP LOCKED` on PostgreSQL), re-validates the visit and consent, sends, and records the message and delivery log. Several workers can run safely. Crashed sends are never resent blindly.
* **WhatsApp adapter** — `CloudApiProvider` (Graph API `/{phone-number-id}/messages`, template + quick-reply payloads) and `SimulationProvider`. Real webhooks and simulator taps converge on the same `apply_patient_action()` logic.
* **Clock** — all business time goes through a hospital-scoped clock (real time, or the demo clock for demo hospitals only).

**Deviation from the preferred stack:** none for production. SQLite is additionally supported only for the one-command laptop demo; the full test suite passes on both.

### Folder structure
```
tectha-followup-engine/
├── backend/                 FastAPI service
│   ├── app/
│   │   ├── api/routes/      auth, public, appointments, patients, followups, insights,
│   │   │                    messages, admin, webhooks, system, demo
│   │   ├── core/            config, security, permissions, rate limiting
│   │   ├── db/              engine/session, base mixins (UUID, timestamps, soft delete)
│   │   ├── models/          core (hospitals, users, roles, doctors), clinical, messaging, platform
│   │   ├── schemas/         request validation + response serializers
│   │   ├── services/        appointments, scheduling, reminders, dispatcher, followups,
│   │   │   └── whatsapp/    provider (Cloud API / simulation), templates (EN/TA), outbound, inbound
│   │   └── worker.py        background reminder worker
│   ├── alembic/versions/    0001 schema, 0002 roles & permissions
│   ├── scripts/             seed_demo.py, create_sysadmin.py
│   └── tests/               65 tests (PostgreSQL or SQLite)
├── frontend/                Next.js app
│   └── src/app/             (app)/… staff & admin screens, book/[slug], r/[token], login …
├── e2e/ui_scenario.py       browser test of the full Mr. Ravi journey (Playwright + Chrome)
├── deploy/                  Caddyfile, backup loop, restore script
├── docker-compose.yml       db, api, worker, web, caddy, backup
├── start-demo.sh / .ps1     one-command local demo
└── .env.example
```

### Database (PostgreSQL, migrations in `backend/alembic/versions`)
`hospitals` · `users` · `roles` · `permissions` · `role_permissions` · `password_reset_tokens` · `doctors` · `doctor_availability` · `patients` · `appointments` · `followups` · `followup_contacts` · `reminder_schedules` · `whatsapp_messages` · `message_delivery_logs` · `whatsapp_configs` · `message_templates` · `monthly_reports` · `audit_logs` · `system_settings` (20 tables).

UUID keys, foreign keys everywhere (including the two circular references, added after both tables exist), created/updated timestamps, soft delete for hospitals/users/doctors/patients, partial unique indexes for patient identity and "one open follow-up per visit", a unique slot key for double-booking protection, unique idempotency keys for reminders, unique WhatsApp message IDs for webhook de-duplication, and indexes on every hot query path. Enum columns are VARCHAR + CHECK constraints (portable). Migrations were verified with an upgrade → downgrade → upgrade round trip.

---

## 5. Going live with WhatsApp (what's needed)

The integration is built against the official **WhatsApp Business Platform Cloud API**; it has been exercised against a faithful stand-in of the Graph API in automated tests, **but has not yet been run against Meta with real credentials** (none were available). To enable real messages:

1. **Meta Business Manager** — verify the business (TEC THA or the hospital).
2. **Meta developer app** (type *Business*) → add the **WhatsApp** product. Note the **App secret** (Settings → Basic) → `META_APP_SECRET`.
3. **Phone number** — add and verify the hospital's WhatsApp Business number (must not be in use on the WhatsApp app). Note the **Phone number ID** and **WhatsApp Business Account ID**.
4. **Permanent token** — create a *System user* with `whatsapp_business_messaging` and `whatsapp_business_management`, generate a token.
5. **Templates** — in WhatsApp Manager create, in category *Utility*, exactly the templates shown in **Settings → Message templates** (names `appointment_reminder_v1`, `followup_reminder_v1`; languages `en` and `ta`; body text as shown; two quick-reply buttons). Have the marketing lead review the Tamil wording first. Wait for approval, then press **Sync approval status**.
6. **Webhook** — deploy on a public HTTPS domain, then in the Meta app → WhatsApp → Configuration set the callback URL `https://<domain>/api/webhooks/whatsapp`, the verify token = `WHATSAPP_VERIFY_TOKEN`, and subscribe to **messages**.
7. In the app (hospital admin): **Settings → WhatsApp** → enter phone number ID, WABA ID and token → **Verify with WhatsApp** → **Send test** to your own number → switch to **Live**.

Notes: business-initiated reminders must use approved templates; free-text replies (confirmations, reschedule links) are only allowed within 24 hours of the patient's message, which is when the app sends them. Per-conversation charges apply on Meta's side. Patients must have opted in (the booking form and reception screen record consent).

---

## 6. Deployment (Docker)

```bash
cp .env.example .env          # set DOMAIN, POSTGRES_PASSWORD, SECRET_KEY, ENCRYPTION_KEY, WhatsApp values
docker compose up -d --build  # db, api (runs migrations), worker, web, caddy (HTTPS), nightly backups
docker compose exec api python -m scripts.create_sysadmin --email ops@yourdomain.in   # prompts for a password
```
Then sign in as the system admin → **Hospitals → Onboard hospital**. The hospital admin adds doctors and consultation hours (Settings → Doctors & schedules), shares the booking link, and connects WhatsApp.

* Backups: `./backups/tectha-*.dump` nightly (14 days kept). Restore: `./deploy/restore.sh backups/<file>.dump`. Keep a copy of `ENCRYPTION_KEY` with your backups.
* Scale: add more `worker` replicas safely; for several API replicas put a shared rate limiter in front (the built-in one is per process).
* Demo server: same stack with `ENVIRONMENT=development`, `DEMO_MODE=true`, `DEMO_PASSWORD=…`, then `docker compose exec api python -m scripts.seed_demo`.

### Running without Docker (development)
```bash
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt
cp ../.env.example .env   # set DATABASE_URL, SECRET_KEY, ENCRYPTION_KEY, COOKIE_SECURE=false, ENVIRONMENT=development
alembic upgrade head && uvicorn app.main:app --reload --port 8000     # API docs at /api/docs
python -m app.worker                                                  # in a second terminal
cd ../frontend && npm ci && npm run dev                               # http://localhost:3000 (proxies /api to :8000)
```

---

## 7. Tests

```bash
cd backend && pytest                                         # PostgreSQL (TEST_DATABASE_URL, default tectha_test on localhost)
TEST_DATABASE_URL=sqlite:////tmp/tectha-test.db pytest      # SQLite
cd frontend && npx tsc --noEmit && npx eslint src && npm run build
python e2e/ui_scenario.py --base http://localhost:3000 --password <DEMO_PASSWORD>   # needs both servers + Chrome
```

Backend coverage (65 tests): login/logout, lockout, CSRF, password reset & session revocation; role permissions; hospital data isolation; system admin cannot read patients; public page leaks no patient data; booking, reference format, validation (past, closed day, off-slot, window, phone, honeypot); **duplicate slot prevention incl. 8 concurrent requests**; patient de-duplication; status transitions; cancel frees slot; staff reschedule; search/filters; appointment reminder timing (IST → UTC), not early, exactly once, Tamil template, same-day skip, late-booking catch-up and quiet hours, no-consent skip, reschedule/cancel handling; follow-up 7-day & 3-day scheduling (25 & 29 Nov for 2 Dec), short-notice boundaries, catch-up, duplicates refused, date change, unconfirmed → red → overdue/missed, contact log, returning visit auto-completes follow-up, consent withdrawal; Cloud API request format, transient failure retry with backoff, permanent failure + manual retry, timeout → uncertain, credential verification, demo patients never sent; webhook verification, bad signature rejected, delivery statuses never downgrade, failed status, button reply (once, despite redelivery), spoofed sender ignored, Reschedule → link → moved, STOP; simulator; report attribution, simulated messages not counted for real hospitals, CSV & snapshot; demo isolation, demo reset, **full Mr. Ravi scenario**, hospital onboarding.

---

## 8. Status

| Area | Status |
|---|---|
| All five V1 modules, three roles, 14 required screens + WhatsApp inbox/simulator + demo panel | **Fully implemented** |
| Backend suite — 65/65 on PostgreSQL 16 and 65/65 on SQLite; migrations round-trip | **Tested successfully** |
| Frontend type-check, lint, production build; browser run of the complete Mr. Ravi journey (24 checkpoints, admin/staff/system-admin, mobile) with no console errors | **Tested successfully** |
| Real WhatsApp delivery, Meta webhooks from Meta's servers, template approval sync | **Requires external credentials** (§5) — code paths tested against a simulated Graph API |
| Password-reset emails | **Requires SMTP credentials** (otherwise logged in development; admins can reset staff passwords) |
| `docker compose` stack and Caddy HTTPS | **Not yet verified** — no Docker daemon was available in the build environment; files follow standard images and configuration |
| `start-demo.ps1` on Windows | **Not yet verified** on a Windows machine (the macOS/Linux script's steps were exercised) |

### Known limitations
* Rate limiting is per API process (use the proxy or a shared store when running several API replicas).
* If a visit is moved to a new time on the same day *after* its reminder was sent, no second reminder is sent (by design, to avoid duplicates).
* Doctor leave/holidays are handled by editing consultation hours; there is no separate holiday calendar in V1.
* Tamil message wording should be reviewed by a native speaker before template submission.
* The demo clock is frozen (it moves only when the presenter moves it).
#   h e a l t h _ f o l l o w u p _ e n g i n e  
 