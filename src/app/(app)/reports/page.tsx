"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight, Download, HeartHandshake, Info, Printer, Save } from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { Button, Card, CardHeader, ErrorState, Loading, Notice, PageHeader, StatCard } from "@/components/ui";
import { RoiCalculator } from "@/components/roi-calculator";
import { api, errorMessage } from "@/lib/api";
import { monthLabel } from "@/lib/format";
import { useData } from "@/lib/hooks";

interface Report {
  hospital: string; year: number; month: number; period_label: string; generated_at: string; includes_simulated_messages: boolean;
  appointments: { total: number; completed: number; cancelled: number; missed: number; confirmed_pending_visit: number; awaiting_confirmation: number; reschedule_requested: number; attendance_rate: number | null; online_bookings: number; confirmed_via_whatsapp: number };
  followups: { scheduled: number; completed: number; missed: number; open: number; return_rate: number | null };
  retention: { brought_back: number; returned_without_reminder: number; unique_patients_seen: number; returning_patients: number; returning_patient_share: number | null };
  reminders: { total: number; sent: number; delivered: number; read: number; simulated: number; failed: number; appointment_reminders: number; followup_reminders: number; confirmations: number; reschedule_requests: number };
  daily: { date: string; total: number; completed: number; cancelled: number; no_show: number }[];
  trend: { label: string; appointments: number; completed: number; cancelled: number; missed: number; brought_back: number; followups_due: number; followups_completed: number }[];
  summary: string; summary_detail: string;
}

const C = { violet: "#9b5de5", ink: "#121214", ok: "#138a5b", danger: "#d32f2f", slate: "#9ca2ac", warn: "#b26a00" };

export default function ReportsPage() {
  const { me } = useAuth();
  const toast = useToast();
  const t = me?.hospital?.today || new Date().toISOString().slice(0, 10);
  const [ym, setYm] = useState<[number, number]>([Number(t.slice(0, 4)), Number(t.slice(5, 7))]);
  const { data: r, error, loading, reload } = useData(() => api.get<Report>("/reports/monthly", { year: ym[0], month: ym[1] }), [ym[0], ym[1]]);
  const [saving, setSaving] = useState(false);
  const shift = (n: number) => setYm(([y, m]) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); return [d.getUTCFullYear(), d.getUTCMonth() + 1]; });
  const isCurrent = ym[0] === Number(t.slice(0, 4)) && ym[1] === Number(t.slice(5, 7));

  async function snapshot() {
    setSaving(true);
    try {
      await api.post("/reports/monthly/snapshot", undefined, { year: ym[0], month: ym[1] });
      toast.success(`${monthLabel(ym[0], ym[1])} figures saved`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monthly report"
        subtitle={r ? `${r.hospital} · generated from recorded appointments, follow-ups and WhatsApp messages` : undefined}
        actions={
          <>
            <div className="flex items-center rounded-lg border border-silver-2 bg-white">
              <button onClick={() => shift(-1)} className="grid size-10 place-items-center text-ink-2 hover:bg-off" aria-label="Previous month"><ChevronLeft className="size-4" /></button>
              <span className="min-w-[140px] text-center text-sm font-bold">{monthLabel(ym[0], ym[1])}</span>
              <button onClick={() => shift(1)} disabled={isCurrent} className="grid size-10 place-items-center text-ink-2 hover:bg-off disabled:opacity-30" aria-label="Next month"><ChevronRight className="size-4" /></button>
            </div>
            <a href={api.url("/reports/monthly.csv", { year: ym[0], month: ym[1] })}><Button variant="secondary" icon={<Download className="size-4" />}>Export CSV</Button></a>
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print / PDF</Button>
            <Button variant="secondary" icon={<Save className="size-4" />} loading={saving} onClick={snapshot}>Save snapshot</Button>
          </>
        }
      />
      {!r ? (loading ? <Loading /> : <ErrorState text={error || "Could not load report"} onRetry={reload} />) : (
        <div className={loading ? "space-y-6 opacity-60" : "space-y-6"}>
          <Card className="overflow-hidden">
            <div className="grid gap-6 bg-ink p-6 text-white sm:p-8 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="text-xs font-semibold tracking-wide text-violet uppercase">{r.period_label} summary</div>
                <p className="mt-2 text-[28px] leading-tight font-bold tracking-tight sm:text-[34px]">{r.summary}</p>
                <p className="mt-2 max-w-2xl text-sm text-white/70">{r.summary_detail}</p>
              </div>
              <div className="grid size-28 place-items-center rounded-full border-4 border-violet/60 bg-white/5">
                <div className="text-center">
                  <HeartHandshake className="mx-auto mb-1 size-5 text-violet" />
                  <div className="tabular text-4xl leading-none font-bold">{r.retention.brought_back}</div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 px-6 py-3 text-[13px] text-muted">
              <span className="flex items-center gap-1.5"><Info className="size-3.5" /> Counted only when a return visit was recorded <b>after</b> a follow-up reminder.</span>
              {r.retention.returned_without_reminder > 0 && <span>{r.retention.returned_without_reminder} other patient(s) returned without a reminder — not counted.</span>}
            </div>
          </Card>
          {r.includes_simulated_messages && <Notice tone="violet">Demo hospital: simulated WhatsApp reminders are included in these figures. For real hospitals only messages accepted by WhatsApp count.</Notice>}

          <section>
            <h2 className="mb-3 text-sm font-bold text-muted uppercase">Appointments</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Total appointments" value={r.appointments.total} hint={`${r.appointments.online_bookings} booked online`} />
              <StatCard label="Completed" value={r.appointments.completed} tone="ok" hint={r.appointments.attendance_rate !== null ? `${r.appointments.attendance_rate}% attendance` : undefined} />
              <StatCard label="Cancelled" value={r.appointments.cancelled} />
              <StatCard label="Missed (no-show)" value={r.appointments.missed} tone={r.appointments.missed ? "danger" : "default"} />
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-bold text-muted uppercase">Follow-ups &amp; retention</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Follow-ups scheduled" value={r.followups.scheduled} hint={`${r.followups.open} still open`} />
              <StatCard label="Follow-ups completed" value={r.followups.completed} tone="ok" hint={`${r.followups.missed} missed`} />
              <StatCard label="Follow-up return rate" value={r.followups.return_rate !== null ? `${r.followups.return_rate}%` : "—"} tone="violet" hint="Returned ÷ (returned + missed)" />
              <StatCard label="Returning patients" value={r.retention.returning_patient_share !== null ? `${r.retention.returning_patient_share}%` : "—"} hint={`${r.retention.returning_patients} of ${r.retention.unique_patients_seen} patients seen had visited before`} />
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-bold text-muted uppercase">WhatsApp reminders</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Reminders" value={r.reminders.total} hint={`${r.reminders.appointment_reminders} visit · ${r.reminders.followup_reminders} follow-up`} />
              <StatCard label="Delivered / read" value={r.reminders.delivered + r.reminders.read} tone="ok" hint={r.reminders.simulated ? `${r.reminders.simulated} simulated (not sent)` : `${r.reminders.sent} sent, awaiting receipt`} />
              <StatCard label="Confirmed via WhatsApp" value={r.reminders.confirmations} tone="violet" hint={`${r.reminders.reschedule_requests} reschedule requests`} />
              <StatCard label="Failed" value={r.reminders.failed} tone={r.reminders.failed ? "danger" : "default"} />
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Daily appointments" subtitle={r.period_label} />
              <div className="h-72 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.daily.map((d) => ({ ...d, day: Number(d.date.slice(8)), other: d.total - d.completed - d.cancelled - d.no_show }))} margin={{ left: -20, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="#e7e9ec" />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#5f6672" }} tickLine={false} axisLine={false} interval={2} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5f6672" }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: "#f6f0fe" }} contentStyle={{ borderRadius: 10, border: "1px solid #e7e9ec", fontSize: 12 }} labelFormatter={(l) => `Day ${l}`} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar isAnimationActive={false} dataKey="completed" name="Completed" stackId="a" fill={C.ok} />
                    <Bar isAnimationActive={false} dataKey="other" name="Upcoming / pending" stackId="a" fill={C.violet} />
                    <Bar isAnimationActive={false} dataKey="no_show" name="No-show" stackId="a" fill={C.danger} />
                    <Bar isAnimationActive={false} dataKey="cancelled" name="Cancelled" stackId="a" fill={C.slate} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="6-month trend" subtitle="Appointments and patients brought back" />
              <div className="h-72 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={r.trend} margin={{ left: -20, right: 12 }}>
                    <CartesianGrid vertical={false} stroke="#e7e9ec" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5f6672" }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5f6672" }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e7e9ec", fontSize: 12 }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="appointments" name="Appointments" stroke={C.ink} strokeWidth={2} dot={{ r: 3 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="completed" name="Completed" stroke={C.ok} strokeWidth={2} dot={{ r: 3 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="followups_completed" name="Follow-ups returned" stroke={C.warn} strokeWidth={2} dot={{ r: 3 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="brought_back" name="Brought back" stroke={C.violet} strokeWidth={2.5} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Interactive ROI Calculator for Clinic Revenue Recovery */}
          <section className="pt-4">
            <RoiCalculator />
          </section>
        </div>
      )}
    </div>
  );
}
