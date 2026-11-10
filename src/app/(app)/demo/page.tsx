"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlarmClock, ArrowRight, CalendarCheck2, CheckCircle2, Circle, Clock3, Database, ExternalLink, FastForward, FlaskConical,
  Megaphone, Play, RefreshCw, Send, TimerReset, UserPlus,
} from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { Badge } from "@/components/status";
import { Button, Card, CardHeader, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cx, fmtClock, fmtDateLong } from "@/lib/format";
import { useData } from "@/lib/hooks";

interface Scenario {
  anchor: string; now: string; visit_date: string; followup_date: string; reminder_7d: string; reminder_3d: string;
  patient_id: string | null;
  appointment: { id: string; status: string; reference: string } | null;
  followup: { id: string; status: string; due_date: string; attention: string | null } | null;
  steps: { key: string; title: string; clock: string; run?: boolean }[];
}
interface State { now: string; demo_clock: boolean; scenario: Scenario; hospital: { slug: string; timezone: string; name: string } }
interface Totals { sent: number; simulated: number; failed: number; retry: number; skipped: number; overdue: number }

export default function DemoPage() {
  const toast = useToast();
  const { refresh } = useAuth();
  const { data: s, error, reload, setData } = useData(() => api.get<State>("/demo/state"), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [raviPhone, setRaviPhone] = useState("");
  const [confirmReset, setConfirmReset] = useState<null | boolean>(null);

  async function act(key: string, fn: () => Promise<State & { totals?: Totals }>, ok?: (r: State & { totals?: Totals }) => string) {
    setBusy(key);
    try {
      const r = await fn();
      setData(r);
      await refresh(); // updates the demo-time ribbon everywhere
      if (ok) toast.success(ok(r));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  const setClock = (body: Record<string, unknown>, label?: string) => act(label || "clock", () => api.post<State>("/demo/clock", body), (r) => `Demo time: ${fmtClock(r.now, r.hospital.timezone)}`);
  const runReminders = () => act("run", () => api.post<State & { totals: Totals }>("/demo/run-reminders"), (r) => totalsText(r.totals!));

  async function goStep(step: Scenario["steps"][number]) {
    setBusy(step.key);
    try {
      let r = await api.post<State>("/demo/clock", { set_to: step.clock });
      let msg = `Demo time: ${fmtClock(r.now, r.hospital.timezone)}`;
      if (step.run) {
        const out = await api.post<State & { totals: Totals }>("/demo/run-reminders");
        r = out;
        msg += ` · ${totalsText(out.totals)}`;
      }
      setData(r);
      await refresh();
      toast.success(msg);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!s) return error ? <ErrorState text={error} onRetry={reload} /> : <Loading />;
  const sc = s.scenario;
  const tz = s.hospital.timezone;
  const chat = sc.patient_id ? `/messages?patient=${sc.patient_id}` : "/messages";
  const appt = sc.appointment ? `/appointments/${sc.appointment.id}` : "/appointments";
  const done: Record<string, boolean> = {
    book: !!sc.appointment,
    reminder: !!sc.appointment && ["confirmed", "completed"].includes(sc.appointment.status),
    visit: sc.appointment?.status === "completed",
    followup: !!sc.followup,
    r7: !!sc.followup && s.now >= `${sc.reminder_7d}T18:00`,
    r3: !!sc.followup && s.now >= `${sc.reminder_3d}T18:00`,
    red: !!sc.followup?.attention,
    overdue: sc.followup?.status === "missed",
  };
  const links: Record<string, [string, string]> = {
    book: [`/book/${s.hospital.slug}`, "Open public booking page"],
    reminder: [chat, "Open Ravi's WhatsApp"],
    visit: [appt, "Open appointment → Patient visited"],
    followup: [appt, "Set follow-up for 2 December"],
    r7: [chat, "See the 7-day reminder"],
    r3: [chat, "See the 3-day reminder → Confirm or Reschedule"],
    red: ["/overview", "Dashboard: Ravi in red"],
    overdue: ["/follow-ups?view=attention", "Follow-ups → Mark as contacted"],
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Demo hospital only" title="Demo Control" subtitle="Drive the simulated clock and present the full patient journey in 5–10 minutes. Real hospitals are never affected." />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card className="overflow-hidden border-slate-800 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-6 py-5 text-white">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-violet-400 uppercase">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
                  </span>
                  <AlarmClock className="size-4" /> {s.demo_clock ? "Demo clock simulation" : "Real time"} · Asia/Kolkata
                </div>
                <div className="tabular mt-1.5 font-mono text-3xl font-extrabold tracking-tight text-white">
                  {fmtClock(s.now, tz)}
                </div>
              </div>
              <Button variant="primary" icon={<Send className="size-4" />} loading={busy === "run"} onClick={runReminders} className="shadow-md shadow-violet-500/30">
                Trigger due reminders
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 p-4 bg-white">
              <Button size="sm" variant="secondary" icon={<Clock3 className="size-3.5" />} loading={busy === "h"} onClick={() => setClock({ advance_hours: 1 }, "h")}>+1 hour</Button>
              <Button size="sm" variant="secondary" icon={<FastForward className="size-3.5" />} loading={busy === "d1"} onClick={() => setClock({ advance_days: 1 }, "d1")}>+1 day</Button>
              <Button size="sm" variant="secondary" icon={<FastForward className="size-3.5" />} loading={busy === "d7"} onClick={() => setClock({ advance_days: 7 }, "d7")}>+7 days</Button>
              <div className="ml-auto flex items-center gap-2">
                <Input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 w-[210px] text-[13px]" aria-label="Set demo date and time" />
                <Button size="sm" disabled={!custom} loading={busy === "set"} onClick={() => setClock({ set_to: custom }, "set")}>Set</Button>
              </div>
            </div>
            <p className="border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 text-xs text-muted">
              Moving the clock does not send anything by itself — press <b>Trigger due reminders</b> (the background worker also runs automatically).
            </p>
          </Card>

          <Card>
            <CardHeader icon={<Play className="size-5" />} title="Mr. Ravi — guided scenario" subtitle={`Books Monday ${fmtDateLong(sc.anchor)} for Wednesday; follow-up ${fmtDateLong(sc.followup_date)}`} />
            <ol className="divide-y divide-silver">
              {sc.steps.map((st, i) => {
                const isAlt = st.key === "red" || st.key === "overdue";
                return (
                  <li key={st.key} className={cx("flex flex-wrap items-center gap-3 px-5 py-3.5", isAlt && "bg-danger-50/40")}>
                    {done[st.key] ? <CheckCircle2 className="size-5 shrink-0 text-ok" /> : <Circle className="size-5 shrink-0 text-silver-2" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold">{i + 1}. {st.title} {isAlt && <Badge tone="danger" className="ml-1">alternate path</Badge>}</div>
                      <div className="text-xs text-muted">Clock → {fmtClock(new Date(st.clock + ":00+05:30").toISOString(), tz)}{st.run && " · triggers reminders"}</div>
                    </div>
                    {st.key === "book" ? (
                      <Button size="sm" variant="secondary" icon={<UserPlus className="size-3.5" />} onClick={() => setRaviPhone(raviPhone || " ")}>Quick-book Ravi</Button>
                    ) : st.key === "red" && sc.followup ? (
                      <Button size="sm" variant="secondary" loading={busy === "red"} onClick={() => act("red", () => api.post<State>(`/demo/followups/${sc.followup!.id}/no-response`), () => "No response — Ravi is now red on the dashboard")}>Simulate no response</Button>
                    ) : null}
                    <Button size="sm" variant="secondary" icon={<AlarmClock className="size-3.5" />} loading={busy === st.key} onClick={() => goStep(st)}>Set clock</Button>
                    <Link href={links[st.key][0]} target={st.key === "book" ? "_blank" : undefined} className="flex items-center gap-1 text-[13px] font-semibold text-violet-700 hover:underline">
                      {links[st.key][1]} {st.key === "book" ? <ExternalLink className="size-3.5" /> : <ArrowRight className="size-3.5" />}
                    </Link>
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap gap-4 border-t border-silver bg-off/60 px-5 py-3 text-[13px]">
              <span>Appointment: {sc.appointment ? <b>{sc.appointment.reference} · {sc.appointment.status.replace("_", " ")}</b> : <span className="text-muted">not booked yet</span>}</span>
              <span>Follow-up: {sc.followup ? <b className={sc.followup.attention ? "text-danger" : ""}>{fmtDateLong(sc.followup.due_date)} · {sc.followup.attention || sc.followup.status}</b> : <span className="text-muted">not set</span>}</span>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader icon={<Megaphone className="size-5" />} title="Presenter script" subtitle="From the Version 1 brief" />
            <ol className="list-decimal space-y-2.5 py-4 pr-5 pl-10 text-sm">
              <li>Ask: <i>&ldquo;Out of 10 follow-up patients, how many come back?&rdquo;</i></li>
              <li>Book a fake appointment live as Mr. Ravi on the public link.</li>
              <li>Show the WhatsApp reminder — in live mode, send it to the owner&apos;s own phone (with consent).</li>
              <li>Show the dashboard with a missed follow-up in red.</li>
              <li>Close with the Monthly Report: &ldquo;We brought back X patients&rdquo; — then offer the free 2-week pilot.</li>
            </ol>
            <p className="border-t border-silver px-5 py-3 text-xs text-muted">No free-consultation offers or fake reviews (NMC rules). Demo patients are fictional and never messaged.</p>
          </Card>

          <Card>
            <CardHeader icon={<Database className="size-5" />} title="Demo data" />
            <div className="space-y-3 p-5">
              <p className="text-sm text-muted">Sample journeys are replayed through the real engine (bookings, reminders, replies, visits) over the 5 weeks before the anchor Monday, so every figure is genuine engine output.</p>
              <Button className="w-full" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => setConfirmReset(true)}>Reset &amp; load sample data</Button>
              <Button className="w-full" variant="secondary" icon={<TimerReset className="size-4" />} onClick={() => setConfirmReset(false)}>Reset to empty clinic</Button>
              <Button className="w-full" variant="ghost" icon={<CalendarCheck2 className="size-4" />} loading={busy === "real"} onClick={() => setClock({ reset_to_real: true }, "real")}>Use real time</Button>
            </div>
          </Card>
          <Notice tone="violet" title={<span className="flex items-center gap-2"><FlaskConical className="size-4" /> Isolation</span>}>The demo clock and these controls only exist for this demo hospital on a deployment with <code>DEMO_MODE=true</code>. Production deployments refuse to start with demo mode on.</Notice>
        </div>
      </div>

      <Modal open={confirmReset !== null} onClose={() => setConfirmReset(null)} title={confirmReset ? "Reset and load sample data?" : "Reset to an empty clinic?"}
        footer={<><Button variant="secondary" onClick={() => setConfirmReset(null)}>Cancel</Button><Button variant="danger" loading={busy === "reset"} onClick={async () => { const w = confirmReset; setConfirmReset(null); await act("reset", () => api.post<State>("/demo/reset", { with_samples: w }), () => (w ? "Demo reset with 12 sample patients" : "Demo reset — empty clinic")); }}>Reset demo</Button></>}>
        <p className="text-sm text-ink-2">All demo patients, appointments, follow-ups and messages of this demo hospital are deleted. Doctors, staff accounts and settings stay. The clock returns to Monday {fmtDateLong(sc.anchor)}, 9:00 AM.</p>
      </Modal>

      <Modal open={!!raviPhone} onClose={() => setRaviPhone("")} title="Quick-book Mr. Ravi" subtitle={`Dr. Arun Kumar · ${fmtDateLong(sc.visit_date)} · 10:30 AM`}
        footer={<><Button variant="secondary" onClick={() => setRaviPhone("")}>Cancel</Button><Button loading={busy === "ravi"} onClick={async () => { const p = raviPhone.trim(); setRaviPhone(""); await act("ravi", () => api.post<State>("/demo/ravi/book", { phone: p || null }), () => "Mr. Ravi booked for Wednesday 10:30 AM"); }}>Book</Button></>}>
        <Field label="Mobile number (optional)" hint="Leave blank for a fictional number (always simulated). Enter the owner's own number only with their consent, and switch WhatsApp to live mode to deliver a real reminder.">
          <Input value={raviPhone.trim()} onChange={(e) => setRaviPhone(e.target.value || " ")} placeholder="Fictional number" />
        </Field>
        <p className="mt-3 text-xs text-muted">Booking through the public page instead shows the patient&apos;s experience — use the &ldquo;Open public booking page&rdquo; link.</p>
      </Modal>
    </div>
  );
}

function totalsText(t: Totals) {
  const parts = [];
  if (t.simulated) parts.push(`${t.simulated} reminder${t.simulated > 1 ? "s" : ""} simulated`);
  if (t.sent) parts.push(`${t.sent} sent via WhatsApp`);
  if (t.failed) parts.push(`${t.failed} failed`);
  if (t.overdue) parts.push(`${t.overdue} follow-up${t.overdue > 1 ? "s" : ""} now overdue`);
  return parts.length ? parts.join(" · ") : "No reminders were due";
}
