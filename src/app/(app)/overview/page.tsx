"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle, BellRing, CalendarCheck2, CalendarClock, CalendarPlus, CalendarX2, CheckCircle2, Clock3, Copy, HeartHandshake,
  ListChecks, RotateCcw, Send, Users,
} from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { BookVisitModal } from "@/components/book-visit-modal";
import { AppointmentsTable } from "@/components/tables";
import { Button, Card, CardHeader, EmptyState, ErrorState, Input, Loading, PageHeader, StatCard } from "@/components/ui";
import { api } from "@/lib/api";
import { addDays, cx, fmtDateLong, fmtTime } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Appointment, AppointmentStatus, FollowUp } from "@/lib/types";

interface Dashboard {
  today: string; date: string; now: string; demo_clock: boolean;
  day: { counts: Record<AppointmentStatus, number>; total: number; appointments: Appointment[] };
  month: {
    label: string; appointments_total: number; completed: number; cancelled: number; confirmed: number; pending: number; no_show: number;
    reminders_sent: number; reminders_simulated: number; reminders_failed: number; brought_back: number;
    followups_due: number; followups_returned: number; followup_return_rate: number | null;
  };
  followups: { upcoming: FollowUp[]; attention: FollowUp[]; open_count: number; missed_count: number; unconfirmed_count: number };
  reschedule_requests: Appointment[];
  reminders: { failed: number; pending: number };
}

const FILTERS: { key: "all" | AppointmentStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "booked", label: "Awaiting confirmation" },
  { key: "confirmed", label: "Confirmed" },
  { key: "reschedule_requested", label: "Reschedule" },
  { key: "completed", label: "Visited" },
  { key: "cancelled", label: "Cancelled" },
];

export default function OverviewPage() {
  const { me, can } = useAuth();
  const toast = useToast();
  const [day, setDay] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [booking, setBooking] = useState<FollowUp | null>(null);
  const { data, error, loading, reload } = useData(() => api.get<Dashboard>("/dashboard", day ? { date: day } : undefined), [day]);
  const isAdmin = can("hospital.reports.view");
  const h = me?.hospital;

  if (!data) return loading ? <Loading /> : <ErrorState text={error || "Could not load the dashboard"} onRetry={reload} />;

  const today = data.today;
  const isToday = data.date === today;
  const list = data.day.appointments.filter((a) => filter === "all" || a.status === filter);
  const bookingUrl = typeof window !== "undefined" && h ? `${window.location.origin}/book/${h.slug}` : "";
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: h?.timezone || "Asia/Kolkata" }).format(new Date(data.now)));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isAdmin ? "Hospital admin" : "Reception desk"}
        title={`${greet}, ${me?.full_name.split(" ")[0]}`}
        subtitle={<>{fmtDateLong(today)}{data.demo_clock && <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-800">DEMO CLOCK</span>}</>}
        actions={
          <>
            <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard?.writeText(bookingUrl); toast.success("Booking link copied — share it on WhatsApp, Google profile or your website"); }}>
              Copy booking link
            </Button>
            {can("appointments.manage") && (
              <Link href="/book-appointment"><Button icon={<CalendarPlus className="size-4" />}>Book appointment</Button></Link>
            )}
          </>
        }
      />

      {/* Today */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={isToday ? "Today's appointments" : "Appointments"} value={data.day.total} icon={<CalendarCheck2 className="size-5" />} hint={isToday ? "Booked for today" : fmtDateLong(data.date)} onClick={() => setFilter("all")} active={filter === "all"} />
        <StatCard label="Confirmed" value={data.day.counts.confirmed} tone="ok" icon={<CheckCircle2 className="size-5" />} hint="Patient confirmed" onClick={() => setFilter("confirmed")} active={filter === "confirmed"} />
        <StatCard label="Pending confirmation" value={data.day.counts.booked + data.day.counts.reschedule_requested} tone="warn" icon={<Clock3 className="size-5" />} hint={data.day.counts.reschedule_requested ? `${data.day.counts.reschedule_requested} want to reschedule` : "No reply yet"} onClick={() => setFilter("booked")} active={filter === "booked"} />
        <StatCard label="Cancelled" value={data.day.counts.cancelled} icon={<CalendarX2 className="size-5" />} hint={`${data.day.counts.completed} visited · ${data.day.counts.no_show} no-show`} onClick={() => setFilter("cancelled")} active={filter === "cancelled"} />
      </section>

      {/* Month & follow-ups */}
      <section className={cx("grid grid-cols-2 gap-3", isAdmin ? "md:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-3")}>
        {isAdmin && <StatCard label="Appointments this month" value={data.month.appointments_total} hint={`${data.month.completed} completed · ${data.month.cancelled} cancelled`} icon={<ListChecks className="size-5" />} />}
        <StatCard label="Upcoming follow-ups" value={data.followups.open_count} icon={<CalendarClock className="size-5" />} hint="Open, due today or later" />
        <StatCard label="Need a call" value={data.followups.attention.length} tone={data.followups.attention.length ? "danger" : "default"} icon={<AlertTriangle className="size-5" />} hint={`${data.followups.unconfirmed_count} no response · ${data.followups.attention.length - data.followups.unconfirmed_count} overdue`} />
        <StatCard label="Missed follow-ups" value={data.followups.missed_count} tone={data.followups.missed_count ? "danger" : "default"} icon={<RotateCcw className="size-5" />} hint="Date passed, no visit recorded" />
        {isAdmin && (
          <StatCard
            label="WhatsApp reminders"
            value={data.month.reminders_sent + data.month.reminders_simulated}
            icon={<Send className="size-5" />}
            tone="violet"
            hint={data.month.reminders_simulated ? `${data.month.reminders_simulated} simulated · ${data.month.reminders_sent} via WhatsApp` : `${data.month.reminders_failed} failed this month`}
          />
        )}
        {isAdmin && (
          <StatCard label="Brought back this month" value={data.month.brought_back} tone="ok" icon={<HeartHandshake className="size-5" />}
            hint={data.month.followup_return_rate !== null ? `${data.month.followup_return_rate}% follow-up return rate` : "Returned after a reminder"} />
        )}
      </section>

      <div className="grid gap-6 2xl:grid-cols-[1fr_400px]">
        <Card className="min-w-0">
          <CardHeader
            icon={<CalendarCheck2 className="size-5" />}
            title={isToday ? "Today's appointments" : `Appointments · ${fmtDateLong(data.date)}`}
            subtitle="Confirm, mark visits and handle no-shows from here"
            action={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDay(addDays(data.date, -1))} aria-label="Previous day">‹</Button>
                <Input type="date" value={data.date} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-8 w-[150px] text-[13px]" aria-label="Choose date" />
                <Button size="sm" variant="ghost" onClick={() => setDay(addDays(data.date, 1))} aria-label="Next day">›</Button>
                {!isToday && <Button size="sm" variant="secondary" onClick={() => setDay(null)}>Today</Button>}
              </div>
            }
          />
          <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-5 py-3 bg-slate-50/50">
            {FILTERS.map((f) => {
              const n = f.key === "all" ? data.day.total : data.day.counts[f.key];
              const isActive = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cx(
                    "shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[12px] font-bold transition-all select-none cursor-pointer",
                    isActive
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-white border border-slate-200/90 text-slate-700 hover:bg-slate-100 hover:border-slate-300",
                  )}
                >
                  <span>{f.label}</span>
                  <span className={cx("tabular rounded-full px-1.5 py-0.2 text-[10px]", isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600 font-extrabold")}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
          {list.length ? (
            <AppointmentsTable items={list} today={today} onChanged={reload} />
          ) : (
            <EmptyState icon={<CalendarCheck2 className="size-5" />} title={data.day.total ? "Nothing matches this filter" : "No appointments on this day"} text={data.day.total ? undefined : "Share your booking link or book a patient from reception."} />
          )}
        </Card>

        <div className="grid content-start gap-6 lg:grid-cols-2 2xl:grid-cols-1">
          <Card className={cx(data.followups.attention.length > 0 && "border-rose-300 ring-2 ring-rose-500/10 shadow-sm")}>
            <CardHeader
              icon={<AlertTriangle className="size-5 text-rose-600" />}
              title={<span className="text-rose-600 font-extrabold tracking-tight">Needs a call</span>}
              subtitle="Unconfirmed or overdue follow-ups"
              action={<Link href="/follow-ups?view=attention" className="text-[13px] font-bold text-violet-700 hover:text-violet-800 hover:underline">View all</Link>}
            />
            {data.followups.attention.length ? (
              <ul className="divide-y divide-rose-100">
                {data.followups.attention.slice(0, 6).map((f) => (
                  <li key={f.id} className="flex items-center gap-3 border-l-4 border-l-rose-500 bg-rose-50/40 px-4 py-3 hover:bg-rose-50/70 transition-colors">
                    <div className="min-w-0 flex-1">
                      <Link href={`/patients/${f.patient.id}`} className="block truncate text-sm font-bold text-ink hover:text-violet-700">{f.patient.full_name}</Link>
                      <div className="text-xs font-semibold text-rose-600">{f.attention === "overdue" ? "Overdue — no visit recorded" : "No response to reminders"} · due {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(f.due_date + "T12:00:00Z"))}</div>
                    </div>
                    <a href={`tel:${f.patient.phone}`} className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-rose-600 border border-rose-200 shadow-xs hover:bg-rose-600 hover:text-white transition-all">Call</a>
                    <Button size="sm" variant="secondary" onClick={() => setBooking(f)}>Book</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<CheckCircle2 className="size-5 text-emerald-600" />} title="All follow-ups on track" text="Patients who don't respond or miss their date will appear here in red." />
            )}
          </Card>

          {data.reschedule_requests.length > 0 && (
            <Card>
              <CardHeader icon={<RotateCcw className="size-5" />} title="Reschedule requests" subtitle="Patients who tapped Reschedule on WhatsApp" />
              <ul className="divide-y divide-silver">
                {data.reschedule_requests.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{a.patient.full_name}</div>
                      <div className="text-xs text-muted">Was {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(a.date + "T12:00:00Z"))} · {fmtTime(a.start_time)} · {a.doctor.name}</div>
                    </div>
                    <Link href={`/appointments/${a.id}`}><Button size="sm" variant="secondary">Reschedule</Button></Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader icon={<BellRing className="size-5" />} title="Upcoming follow-ups" subtitle="Next 30 days" action={<Link href="/follow-ups?view=upcoming" className="text-[13px] font-semibold text-violet-700 hover:underline">View all</Link>} />
            {data.followups.upcoming.length ? (
              <FollowUpsMini items={data.followups.upcoming.slice(0, 6)} />
            ) : (
              <EmptyState icon={<Users className="size-5" />} title="No follow-ups scheduled" text="Open a visit and set the next follow-up date — reminders go out 7 and 3 days before." />
            )}
          </Card>
        </div>
      </div>

      {isAdmin && data.reminders.failed > 0 && (
        <Card className="border-danger/30 p-4 text-sm">
          <span className="font-bold text-danger">{data.reminders.failed} WhatsApp reminder{data.reminders.failed > 1 ? "s" : ""} failed.</span>{" "}
          <Link href="/messages?tab=failed" className="font-semibold text-violet-700 hover:underline">Review and retry</Link>
        </Card>
      )}
      <BookVisitModal fu={booking} today={today} onClose={() => setBooking(null)} onDone={reload} />
    </div>
  );
}

function FollowUpsMini({ items }: { items: FollowUp[] }) {
  return (
    <ul className="divide-y divide-silver">
      {items.map((f) => (
        <li key={f.id} className="flex items-center gap-3 px-4 py-3">
          <div className="tabular w-12 shrink-0 text-center">
            <div className="text-[10px] font-bold text-muted uppercase">{new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(f.due_date + "T12:00:00Z"))}</div>
            <div className="text-lg leading-none font-bold">{Number(f.due_date.slice(8))}</div>
          </div>
          <div className="min-w-0 flex-1">
            <Link href={`/patients/${f.patient.id}`} className="block truncate text-sm font-semibold hover:underline">{f.patient.full_name}</Link>
            <div className="truncate text-xs text-muted">{f.doctor.name} · {f.status === "scheduled" ? (f.reminders.some((r) => r.status === "sent") ? "Reminder sent" : "Reminders scheduled") : f.status === "confirmed" ? "Confirmed" : "Rescheduled"}</div>
          </div>
          {f.status !== "scheduled" && <CheckCircle2 className="size-4 text-ok" />}
        </li>
      ))}
    </ul>
  );
}
