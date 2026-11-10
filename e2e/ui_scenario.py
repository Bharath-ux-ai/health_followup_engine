"""Browser end-to-end check of the Mr. Ravi demo through the real UI (Next.js + FastAPI + PostgreSQL).

Run with both servers up:  python e2e/ui_scenario.py --base http://localhost:3000 --password <DEMO_PASSWORD>
Screenshots are written to e2e/screenshots/.
"""
import argparse
import os
import re
import sys

from playwright.sync_api import Page, expect, sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:3000")
ap.add_argument("--password", default=os.environ.get("DEMO_PASSWORD", ""))
ap.add_argument("--chrome", default="/usr/bin/google-chrome")
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "screenshots"))
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
BASE = args.base
step_no = 0


def shot(page: Page, name: str, full=False):
    global step_no
    step_no += 1
    path = os.path.join(args.out, f"{step_no:02d}-{name}.png")
    page.wait_for_timeout(350)
    page.screenshot(path=path, full_page=full)
    print(f"  ✓ {name}")


def api(page: Page, method: str, path: str, body=None):
    r = page.request.fetch(f"{BASE}/api{path}", method=method, data=body, headers={"X-Requested-With": "tectha"})
    assert r.ok, f"{method} {path} -> {r.status} {r.text()}"
    return r.json()


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chrome, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and "Failed to load resource" not in m.text and errors.append(m.text))

        print("Sign in as hospital admin")
        page.goto(f"{BASE}/overview")
        expect(page).to_have_url(re.compile(r"/login\?next="))  # proxy gate redirects unauthenticated users
        page.wait_for_load_state("networkidle")  # wait for hydration before typing
        shot(page, "login")
        page.get_by_label("Email").fill("admin@tectha-demo.in")
        page.get_by_label("Password").fill("wrong-password-1")
        page.get_by_role("button", name="Sign in").click()
        expect(page.get_by_text("Incorrect email or password")).to_be_visible()
        page.get_by_label("Password").fill(args.password)
        page.get_by_role("button", name="Sign in").click()
        expect(page).to_have_url(re.compile(r"/overview"))

        print("Reset the demo with sample data")
        api(page, "POST", "/demo/reset", {"with_samples": True})
        page.goto(f"{BASE}/overview")
        expect(page.get_by_text("Needs a call").first).to_be_visible()
        expect(page.get_by_text("Karthikeyan Ramasamy").first).to_be_visible()
        shot(page, "overview-admin", full=True)

        print("Step 1 — Mr. Ravi books on the public link (Monday)")
        api(page, "POST", "/demo/clock", {"set_to": "2026-11-09T10:00"})
        pub = ctx.new_page()
        pub.set_viewport_size({"width": 430, "height": 900})
        pub.goto(f"{BASE}/book/tectha-clinic")
        pub.wait_for_load_state("networkidle")
        expect(pub.get_by_text("Choose a doctor")).to_be_visible()
        shot(pub, "public-booking-doctors")
        pub.get_by_role("button", name=re.compile("Dr. Arun Kumar")).click()
        pub.get_by_role("button", name=re.compile(r"Wed\s*11\s*Nov")).click()
        expect(pub.get_by_role("button", name="10:30 AM")).to_be_enabled()
        pub.get_by_role("button", name="10:30 AM").click()
        shot(pub, "public-booking-slots")
        pub.get_by_role("button", name="Continue").click()
        pub.get_by_label("Patient name").fill("Ravi")
        pub.get_by_label("Mobile number (WhatsApp)").fill("98940 99999")
        pub.get_by_role("button", name="Confirm booking").click()
        expect(pub.get_by_text("Appointment booked")).to_be_visible()
        ref = pub.locator("dd span.font-mono").inner_text()
        assert re.fullmatch(r"TT-[A-Z2-9]{6}", ref), ref
        shot(pub, "public-booking-confirmed")
        # the same slot is now unavailable to anyone else
        pub.goto(f"{BASE}/book/tectha-clinic")
        pub.get_by_role("button", name=re.compile("Dr. Arun Kumar")).click()
        pub.get_by_role("button", name=re.compile(r"Wed\s*11\s*Nov")).click()
        expect(pub.get_by_role("button", name="10:30 AM")).to_be_disabled()
        pub.close()

        page.goto(f"{BASE}/appointments")
        expect(page.get_by_text(ref)).to_be_visible()
        shot(page, "appointments-list")

        print("Step 2 — Tuesday 6:05 PM: reminder goes out, Ravi taps Confirm")
        page.goto(f"{BASE}/demo")
        page.get_by_role("listitem").filter(has_text="Tuesday-evening reminder").get_by_role("button", name="Set clock").click()
        expect(page.get_by_text(re.compile(r"reminders? simulated"))).to_be_visible()
        shot(page, "demo-control")
        st = api(page, "GET", "/demo/state")
        pid = st["scenario"]["patient_id"]
        page.goto(f"{BASE}/messages?patient={pid}")
        chat = page.locator(".wa-wall")
        expect(chat.get_by_text(re.compile("Hello Ravi,\\s+This is a reminder from TEC THA Multispeciality Clinic"))).to_be_visible()
        expect(page.get_by_text("SIMULATOR — what Ravi would see")).to_be_visible()
        shot(page, "whatsapp-reminder")
        chat.get_by_role("button", name="Confirm", exact=True).click()
        expect(chat.get_by_text(re.compile("Thank you, Ravi. Your appointment with Dr. Arun Kumar"))).to_be_visible()
        shot(page, "whatsapp-confirmed")

        print("Step 3 — Wednesday visit, staff marks completed and sets follow-up for 2 December")
        api(page, "POST", "/demo/clock", {"set_to": "2026-11-11T10:45"})
        aid = st["scenario"]["appointment"]["id"]
        page.goto(f"{BASE}/appointments/{aid}")
        page.get_by_role("button", name="Patient visited").click()
        expect(page.get_by_text("Completed").first).to_be_visible()
        page.get_by_label("Follow-up date").fill("2026-12-02")
        expect(page.get_by_text(re.compile(r"Reminders: Wed, 25 Nov and Sun, 29 Nov"))).to_be_visible()
        page.get_by_role("button", name="Save follow-up").click()
        expect(page.get_by_text("Wednesday, 2 December 2026")).to_be_visible()
        shot(page, "appointment-followup-set")

        print("Steps 5-6 — 7-day and 3-day reminders (25 & 29 Nov)")
        for when in ("2026-11-25T18:05", "2026-11-29T18:05"):
            api(page, "POST", "/demo/clock", {"set_to": when})
            api(page, "POST", "/demo/run-reminders")
        page.goto(f"{BASE}/messages?patient={pid}")
        chat = page.locator(".wa-wall")
        expect(chat.get_by_text("7-day reminder")).to_be_visible()
        expect(chat.get_by_text("3-day reminder")).to_be_visible()
        shot(page, "whatsapp-followup-reminders")

        print("Step 8 — no response: Ravi turns red on the dashboard")
        st = api(page, "GET", "/demo/state")
        fid = st["scenario"]["followup"]["id"]
        api(page, "POST", f"/demo/followups/{fid}/no-response")
        page.goto(f"{BASE}/overview")
        red_item = page.locator("li.border-l-danger").filter(has_text="Ravi")
        expect(red_item).to_be_visible()
        expect(red_item.get_by_text("No response to reminders")).to_be_visible()
        shot(page, "overview-ravi-red", full=True)

        print("Staff identifies and contacts him")
        page.goto(f"{BASE}/follow-ups?view=attention")
        row = page.locator("tr").filter(has_text="Ravi").first
        expect(row).to_have_class(re.compile("bg-danger-50"))
        row.get_by_role("button", name="Contacted").click()
        page.get_by_label("Outcome").select_option("will_visit")
        page.get_by_label("Note (optional)").fill("Will come on Friday")
        page.get_by_role("button", name="Save contact").click()
        expect(page.get_by_text("Contact with Ravi recorded")).to_be_visible()
        shot(page, "followups-attention")

        print("Step 7 — Ravi taps Reschedule on the 3-day reminder and picks a new time")
        page.goto(f"{BASE}/messages?patient={pid}")
        page.locator(".wa-wall").get_by_role("button", name="Reschedule", exact=True).last.click()
        dialog = page.get_by_role("dialog")
        expect(dialog.get_by_text("Patient's reschedule page")).to_be_visible()
        dialog.get_by_role("button", name=re.compile(r"Fri\s*4\s*Dec")).click()
        dialog.get_by_role("button", name="11:00 AM").click()
        dialog.get_by_role("button", name=re.compile("Confirm 11:00 AM")).click()
        expect(dialog.get_by_text("You're booked")).to_be_visible()
        shot(page, "reschedule-link")
        page.keyboard.press("Escape")
        fu = api(page, "GET", f"/followups/{fid}")
        assert fu["status"] == "rescheduled" and fu["due_date"] == "2026-12-04" and fu["attention"] is None, fu

        print("Visit on 4 Dec → December report says he was brought back")
        api(page, "POST", "/demo/clock", {"set_to": "2026-12-04T11:20"})
        api(page, "POST", f"/appointments/{fu['visit']['id']}/status", {"status": "completed"})
        page.goto(f"{BASE}/reports")
        expect(page.get_by_text(re.compile(r"We brought back \d+ patients? this month\."))).to_be_visible()
        expect(page.locator(".recharts-surface").first).to_be_visible()
        shot(page, "monthly-report", full=True)
        dl = page.request.get(f"{BASE}/api/reports/monthly.csv?year=2026&month=12")
        assert dl.ok and "We brought back 1 patient this month." in dl.text(), dl.text()[:300]

        print("Other screens render")
        for path, text, name in [
            ("/patients", "Lakshmi Narayanan", "patients"),
            ("/settings/templates", "உறுதிசெய்", "templates"),
            ("/settings/whatsapp", "Go-live checklist", "whatsapp-settings"),
            ("/settings/doctors", "Dr. Karthik", "doctors"),
            ("/settings/staff", "staff@tectha-demo.in", "staff"),
            ("/book-appointment", "Online booking link", "book-appointment"),
        ]:
            page.goto(f"{BASE}{path}")
            expect(page.get_by_text(text).first).to_be_visible()
            shot(page, name)

        print("Hospital staff sees the staff dashboard without admin menus")
        staff = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
        staff.goto(f"{BASE}/login")
        staff.wait_for_load_state("networkidle")
        staff.get_by_label("Email").fill("staff@tectha-demo.in")
        staff.get_by_label("Password").fill(args.password)
        staff.get_by_role("button", name="Sign in").click()
        expect(staff.get_by_text("Reception desk")).to_be_visible()
        assert staff.get_by_role("link", name="Settings").count() == 0
        assert staff.get_by_role("link", name="Monthly Reports").count() == 0
        shot(staff, "overview-staff")

        print("System admin")
        sysp = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
        sysp.goto(f"{BASE}/login")
        sysp.wait_for_load_state("networkidle")
        sysp.get_by_label("Email").fill("platform@tectha-demo.in")
        sysp.get_by_label("Password").fill(args.password)
        sysp.get_by_role("button", name="Sign in").click()
        expect(sysp.get_by_role("heading", name="Platform overview")).to_be_visible()
        expect(sysp.get_by_text("TEC THA Multispeciality Clinic").first).to_be_visible()
        shot(sysp, "system-admin")

        print("Mobile layout")
        mob = browser.new_context(viewport={"width": 390, "height": 844}, storage_state=ctx.storage_state()).new_page()
        mob.goto(f"{BASE}/overview")
        expect(mob.get_by_role("button", name="Open menu")).to_be_visible()
        shot(mob, "mobile-overview")

        api(page, "POST", "/demo/reset", {"with_samples": True})
        print("Sign out")
        page.goto(f"{BASE}/overview")
        page.get_by_role("button", name="Sign out").click()
        expect(page).to_have_url(re.compile(r"/login"))

        browser.close()
        bad = [e for e in errors if "401" not in e]
        if bad:
            print("Browser errors:\n  " + "\n  ".join(bad[:10]))
            sys.exit(1)
        print(f"UI scenario passed — {step_no} screenshots in {args.out}")


run()
