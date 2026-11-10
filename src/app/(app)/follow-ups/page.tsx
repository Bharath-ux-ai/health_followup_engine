"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlertTriangle, CalendarCheck2, CheckCircle2, Clock3, PhoneCall, RotateCcw, Search, XCircle } from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { BookVisitModal } from "@/components/book-visit-modal";
import { FollowUpBadge, REMINDER_KIND, ReminderBadge } from "@/components/status";
import { CONTACT_OUTCOMES, FollowUpsTable, LogContactModal } from "@/components/tables";
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Pagination, StatCard, Tabs } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { addDays, fmtDate, fmtDateLong, fmtDateTime, fmtPhone, fmtTime } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { FollowUp, Paged } from "@/lib/types";

type View = "attention" | "upcoming" | "missed" | "completed" | "all";
interface Summary { unconfirmed: number; overdue: number; upcoming_7d: number; confirmed: number; completed: number }

function FollowUpsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const { me, can } = useAuth();
  const today = me?.hospital?.today || "";
  const [view, setView] = useState<View>((sp.get("view") as View) || "attention");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [booking, setBooking] = useState<FollowUp | null>(null);
  const openId = sp.get("id");

  useEffect(() => {
    const t = setTimeout(() => { setQuery(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const summary = useData(() => api.get<Summary>("/followups/summary"), []);
  const { data, error, loading, reload } = useData(
    () => api.get<Paged<FollowUp>>("/followups", { view, q: query, date_from: from, date_to: to, page, page_size: 50 }),
    [view, query, from, to, page],
  );
  const refresh = () => { reload(); summary.reload(); };
  const s = summary.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Follow-ups" subtitle="Reminders go out on WhatsApp 7 and 3 days before each follow-up date. Patients who don't respond turn red." />
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="No response" value={s?.unconfirmed ?? "–"} tone={s?.unconfirmed ? "danger" : "default"} icon={<AlertTriangle className="size-5" />} hint="Reminded, not confirmed" onClick={() => setView("attention")} active={view === "attention"} />
        <StatCard label="Overdue" value={s?.overdue ?? "–"} tone={s?.overdue ? "danger" : "default"} icon={<XCircle className="size-5" />} hint="Date passed, no visit" onClick={() => setView("missed")} active={view === "missed"} />
        <StatCard label="Due in 7 days" value={s?.upcoming_7d ?? "–"} icon={<Clock3 className="size-5" />} onClick={() => setView("upcoming")} active={view === "upcoming"} />
        <StatCard label="Confirmed visits" value={s?.confirmed ?? "–"} tone="ok" icon={<CalendarCheck2 className="size-5" />} hint="Booked via WhatsApp or staff" />
        <StatCard label="Returned" value={s?.completed ?? "–"} tone="ok" icon={<CheckCircle2 className="size-5" />} hint="Visit recorded" onClick={() => setView("completed")} active={view === "completed"} />
      </section>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-silver p-4">
          <Tabs value={view} onChange={(v) => { setView(v); setPage(1); }} items={[
            { value: "attention", label: "Needs a call", count: s ? s.unconfirmed + s.overdue : undefined, tone: "danger" },
            { value: "upcoming", label: "Upcoming" },
            { value: "missed", label: "Missed / overdue" },
            { value: "completed", label: "Returned" },
            { value: "all", label: "All" },
          ]} />
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Patient name or phone" className="h-9 pl-9" aria-label="Search follow-ups" />
          </div>
          {view !== "attention" && (
            <div className="flex w-full items-center gap-2 text-sm text-muted">
              Due between <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 max-w-[160px]" /> and <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 max-w-[160px]" />
              {(from || to) && <Button size="sm" variant="ghost" onClick={() => { setFrom(""); setTo(""); }}>Clear</Button>}
            </div>
          )}
        </div>
        {view === "attention" && (
          <div className="border-b border-silver bg-danger-50/50 px-5 py-2.5 text-[13px] text-ink-2">
            <b className="text-danger">Red</b> = reminders went out with no reply as the date approaches, or the date passed with no visit recorded. Not replying on WhatsApp does not mean a patient missed their visit — call to check.
          </div>
        )}
        {error ? <ErrorState text={error} onRetry={reload} /> : !data ? <Loading /> : data.items.length ? (
          <div className={loading ? "opacity-60" : ""}>
            <FollowUpsTable items={data.items} today={today} onChanged={refresh} onBook={can("appointments.manage") ? setBooking : undefined} />
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </div>
        ) : (
          <EmptyState icon={<RotateCcw className="size-5" />} title={view === "attention" ? "No one needs a call right now" : "No follow-ups here"} text={view === "attention" ? "Everyone has confirmed or still has reminders to come." : "Follow-ups are set from a visit's appointment page."} />
        )}
      </Card>
      <BookVisitModal fu={booking} today={today} onClose={() => setBooking(null)} onDone={refresh} />
      <FollowUpDetail id={openId} today={today} onClose={() => router.replace("/follow-ups")} onChanged={refresh} onBook={setBooking} />
    </div>
  );
}

function FollowUpDetail({ id, today, onClose, onChanged, onBook }: { id: string | null; today: string; onClose: () => void; onChanged: () => void; onBook: (f: FollowUp) => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const { data: f, reload } = useData(() => (id ? api.get<FollowUp>(`/followups/${id}`) : Promise.resolve(null)), [id]);
  const [contact, setContact] = useState<FollowUp | null>(null);
  const [newDate, setNewDate] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const manage = can("followups.manage");

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      reload();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={!!id} onClose={onClose} wide title={f ? `Follow-up · ${f.patient.full_name}` : "Follow-up"} subtitle={f ? `${f.doctor.name} · due ${fmtDateLong(f.due_date)}` : ""}>
      {!f ? <Loading /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <FollowUpBadge fu={f} />
            <a href={`tel:${f.patient.phone}`} className="tabular text-sm font-semibold text-violet-700 hover:underline">{fmtPhone(f.patient.phone)}</a>
            <Link href={`/patients/${f.patient.id}`} className="text-sm font-semibold text-violet-700 hover:underline">Patient record</Link>
            {f.due_date !== f.original_due_date && <span className="text-xs text-muted">Originally {fmtDate(f.original_due_date)}</span>}
          </div>
          {f.attention && <Notice tone="danger">{f.attention === "overdue" ? "The follow-up date has passed and no visit was recorded." : "Reminders were sent but the patient hasn't confirmed. Please call."}</Notice>}
          {f.visit && <Notice tone="ok">Visit booked: {fmtDateLong(f.visit.date)} at {fmtTime(f.visit.start_time)} · <Link className="font-semibold underline" href={`/appointments/${f.visit.id}`}>{f.visit.reference}</Link> ({f.visit.status.replace("_", " ")})</Notice>}

          <div>
            <h3 className="mb-2 text-sm font-bold">Reminder history</h3>
            <ul className="space-y-2">
              {f.reminders.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-silver px-3 py-2 text-sm">
                  <span><b>{REMINDER_KIND[r.kind]}</b> <span className="text-muted">· {r.sent_at ? `sent ${fmtDateTime(r.sent_at)}` : r.status === "pending" ? `scheduled ${fmtDateTime(r.scheduled_for)}` : r.skip_reason || r.last_error}</span></span>
                  <ReminderBadge r={r} />
                </li>
              ))}
              {!f.reminders.length && <li className="text-sm text-muted">No reminders.</li>}
            </ul>
          </div>

          {!!f.contacts?.length && (
            <div>
              <h3 className="mb-2 text-sm font-bold">Contact attempts</h3>
              <ul className="space-y-1.5 text-sm">
                {f.contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-2"><span><b>{CONTACT_OUTCOMES[c.outcome]}</b>{c.note && ` — ${c.note}`}</span><span className="text-xs text-muted">{fmtDateTime(c.contacted_at)}{c.by && ` · ${c.by}`}</span></li>
                ))}
              </ul>
            </div>
          )}

          {manage && !["completed", "cancelled"].includes(f.status) && (
            <div className="space-y-4 rounded-xl bg-off p-4">
              <div className="flex flex-wrap gap-2">
                <Button icon={<PhoneCall className="size-4" />} onClick={() => setContact(f)}>Mark as contacted</Button>
                {can("appointments.manage") && ["scheduled", "missed"].includes(f.status) && <Button variant="secondary" onClick={() => { onClose(); onBook(f); }}>Book visit</Button>}
                <Button variant="success" loading={busy === "done"} disabled={f.due_date > addDays(today, 7)} title={f.due_date > addDays(today, 7) ? "Available from a week before the date" : ""}
                  onClick={() => act("done", () => api.post(`/followups/${f.id}/status`, { status: "completed" }), "Marked as returned")}>Patient returned</Button>
                <Button variant="danger" loading={busy === "cancel"} onClick={() => act("cancel", () => api.post(`/followups/${f.id}/status`, { status: "cancelled" }), "Follow-up cancelled")}>Cancel follow-up</Button>
              </div>
              {["scheduled", "missed"].includes(f.status) && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Change follow-up date" hint="Reminders are recalculated automatically"><Input type="date" min={addDays(today, 1)} value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-48" /></Field>
                  <Button variant="secondary" disabled={!newDate} loading={busy === "date"} onClick={() => act("date", () => api.patch(`/followups/${f.id}`, { due_date: newDate }), `Follow-up moved to ${fmtDate(newDate)}`)}>Save date</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <LogContactModal fu={contact} onClose={() => setContact(null)} onSaved={() => { reload(); onChanged(); }} />
    </Modal>
  );
}

export default function FollowUpsPage() {
  return <Suspense fallback={<Loading />}><FollowUpsInner /></Suspense>;
}
