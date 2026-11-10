"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Ban, CalendarClock, Check, CheckCheck, MessageCircle, RotateCcw, Stethoscope, UserX } from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { SlotPicker } from "@/components/slot-picker";
import { AppointmentBadge, FollowUpBadge, MessageStatusLabel, REMINDER_KIND, ReminderBadge } from "@/components/status";
import { ReminderChips, useStatusAction } from "@/components/tables";
import { Button, Card, CardHeader, Checkbox, ErrorState, Field, Input, Loading, Modal, Notice, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { addDays, fmtDate, fmtDateLong, fmtDateTime, fmtPhone, fmtTime } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Appointment, FollowUp, Message, Reminder } from "@/lib/types";

type Detail = Appointment & { followup: FollowUp | null; for_followup: { id: string; due_date: string } | null; reminders: Reminder[]; messages: Message[] };

export default function AppointmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useAuth();
  const toast = useToast();
  const today = me?.hospital?.today || "";
  const { data: a, error, loading, reload } = useData(() => api.get<Detail>(`/appointments/${id}`), [id]);
  const { busy, setStatus } = useStatusAction(reload);
  const [resched, setResched] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [fuDate, setFuDate] = useState("");
  const [savingFu, setSavingFu] = useState(false);

  if (!a) return loading ? <Loading /> : <ErrorState text={error || "Appointment not found"} onRetry={reload} />;
  const active = ["booked", "confirmed", "reschedule_requested"].includes(a.status);
  const manage = can("appointments.manage");
  const visitDay = a.date <= today;

  async function saveFollowUp(e: React.FormEvent) {
    e.preventDefault();
    setSavingFu(true);
    try {
      await api.post(`/appointments/${id}/followup`, { due_date: fuDate });
      toast.success(`Follow-up saved for ${fmtDateLong(fuDate)}. Reminders scheduled 7 and 3 days before.`);
      setFuDate("");
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingFu(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/appointments" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Appointments
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-bold tracking-tight">{a.patient.full_name}</h1>
            <AppointmentBadge status={a.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            <span className="font-mono font-semibold text-ink">{a.reference}</span> · {fmtDateLong(a.date)} at {fmtTime(a.start_time)} · {a.doctor.name}
          </p>
        </div>
        {manage && active && (
          <div className="flex flex-wrap gap-2">
            {a.status !== "confirmed" && <Button variant="secondary" icon={<Check className="size-4" />} loading={busy === a.id + "confirmed"} onClick={() => setStatus(a, "confirmed")}>Mark confirmed</Button>}
            <Button variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => setResched(true)}>Reschedule</Button>
            {visitDay && <Button variant="success" icon={<CheckCheck className="size-4" />} loading={busy === a.id + "completed"} onClick={() => setStatus(a, "completed")}>Patient visited</Button>}
            {visitDay && <Button variant="ghost" icon={<UserX className="size-4" />} loading={busy === a.id + "no_show"} onClick={() => setStatus(a, "no_show")}>No-show</Button>}
            {!visitDay && <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setCancel(true)}>Cancel</Button>}
          </div>
        )}
        {manage && (a.status === "completed" || a.status === "no_show") && (
          <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setStatus(a, a.status === "completed" ? "no_show" : "completed")}>
            Correct to {a.status === "completed" ? "no-show" : "visited"}
          </Button>
        )}
      </div>

      {a.status === "reschedule_requested" && (
        <Notice tone="violet" title="Patient asked to reschedule on WhatsApp">
          They received a link to choose a new time. You can also call them and reschedule here.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {/* Follow-up */}
          <Card>
            <CardHeader icon={<RotateCcw className="size-5" />} title="Next follow-up" subtitle="Reminders go out on WhatsApp 7 days and 3 days before the date" />
            <div className="p-5">
              {a.followup ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-lg font-bold">{fmtDateLong(a.followup.due_date)}</span>
                    <FollowUpBadge fu={a.followup} />
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted">Reminders <ReminderChips fu={a.followup} /></div>
                  <Link href={`/follow-ups?id=${a.followup.id}`} className="text-[13px] font-semibold text-violet-700 hover:underline">Manage follow-up →</Link>
                </div>
              ) : a.status === "cancelled" ? (
                <p className="text-sm text-muted">Cancelled appointments cannot have a follow-up.</p>
              ) : can("followups.manage") ? (
                <form onSubmit={saveFollowUp} className="flex flex-wrap items-end gap-3">
                  <Field label="Follow-up date" className="w-full sm:w-56">
                    <Input type="date" value={fuDate} min={addDays(today > a.date ? today : a.date, 1)} onChange={(e) => setFuDate(e.target.value)} required />
                  </Field>
                  <div className="flex flex-wrap gap-1.5">
                    {[7, 14, 30, 90].map((n) => (
                      <Button key={n} type="button" size="sm" variant="secondary" onClick={() => setFuDate(addDays(a.date, n))}>+{n < 30 ? `${n} days` : `${n / 30} month${n > 30 ? "s" : ""}`}</Button>
                    ))}
                  </div>
                  <Button type="submit" loading={savingFu} disabled={!fuDate}>Save follow-up</Button>
                  {fuDate && <p className="w-full text-xs text-muted">Reminders: {fmtDate(addDays(fuDate, -7))} and {fmtDate(addDays(fuDate, -3))} at {me?.hospital?.reminder_send_time ? fmtTime(me.hospital.reminder_send_time) : "6:00 PM"} (if still in the future).</p>}
                </form>
              ) : (
                <p className="text-sm text-muted">No follow-up scheduled.</p>
              )}
            </div>
          </Card>

          {/* WhatsApp history */}
          <Card>
            <CardHeader icon={<MessageCircle className="size-5" />} title="WhatsApp messages" action={<Link href={`/messages?patient=${a.patient.id}`} className="text-[13px] font-semibold text-violet-700 hover:underline">Open conversation</Link>} />
            {a.messages.length ? (
              <ul className="divide-y divide-silver">
                {a.messages.map((m) => (
                  <li key={m.id} className="px-5 py-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="font-semibold text-ink-2">{m.direction === "inbound" ? "Patient" : "Hospital"}</span>
                      <span>{fmtDateTime(m.occurred_at)}</span>
                      <MessageStatusLabel status={m.status} />
                    </div>
                    <p className="text-sm whitespace-pre-line text-ink-2" lang={m.language === "ta" ? "ta" : undefined}>{m.body}</p>
                    {m.error_message && <p className="mt-1 text-xs text-danger">{m.error_message}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-muted">No messages yet.</p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader icon={<Stethoscope className="size-5" />} title="Details" />
            <dl className="divide-y divide-silver text-sm">
              {[
                ["Patient", <Link key="p" href={`/patients/${a.patient.id}`} className="font-semibold text-violet-700 hover:underline">{a.patient.full_name}</Link>],
                ["Phone", <a key="ph" href={`tel:${a.patient.phone}`} className="tabular font-semibold hover:underline">{fmtPhone(a.patient.phone)}</a>],
                ["WhatsApp consent", a.patient.whatsapp_consent ? "Yes" : "No — reminders are not sent"],
                ["Language", a.patient.preferred_language === "ta" ? "Tamil" : "English"],
                ["Doctor", a.doctor.name],
                ["Booked", `${fmtDateTime(a.booked_at)} · ${a.source === "online" ? "online" : a.source === "followup" ? "from follow-up" : "reception"}`],
                ...(a.confirmed_at ? [["Confirmed", `${fmtDateTime(a.confirmed_at)} via ${a.confirmed_via}`]] : []),
                ...(a.cancelled_at ? [["Cancelled", `${fmtDateTime(a.cancelled_at)}${a.cancel_reason ? " — " + a.cancel_reason : ""}`]] : []),
                ...(a.for_followup ? [["Follow-up visit", `for follow-up due ${fmtDate(a.for_followup.due_date)}`]] : []),
                ...(a.reschedule_count ? [["Rescheduled", `${a.reschedule_count} time${a.reschedule_count > 1 ? "s" : ""}`]] : []),
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-4 px-5 py-2.5">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Reminder timeline" />
            <ul className="space-y-3 p-5">
              {a.reminders.length ? a.reminders.map((r) => (
                <li key={r.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{REMINDER_KIND[r.kind]} · {fmtDate(r.target_date)}</span>
                    <ReminderBadge r={r} />
                  </div>
                  <p className="text-xs text-muted">
                    {r.sent_at ? `Sent ${fmtDateTime(r.sent_at)}` : r.status === "pending" ? `Scheduled for ${fmtDateTime(r.scheduled_for)}` : r.skip_reason || r.last_error || ""}
                  </p>
                </li>
              )) : <li className="text-sm text-muted">No reminders.</li>}
            </ul>
          </Card>
        </div>
      </div>

      <RescheduleModal open={resched} appt={a} today={today} onClose={() => setResched(false)} onDone={reload} />
      <Modal open={cancel} onClose={() => setCancel(false)} title="Cancel this appointment?"
        footer={<><Button variant="secondary" onClick={() => setCancel(false)}>Keep</Button><Button variant="danger" loading={!!busy} onClick={async () => { await setStatus(a, "cancelled", reason || undefined); setCancel(false); }}>Cancel appointment</Button></>}>
        <Field label="Reason (optional)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
      </Modal>
    </div>
  );
}

function RescheduleModal({ open, appt, today, onClose, onDone }: { open: boolean; appt: Appointment; today: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    if (!date || !time) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/appointments/${appt.id}/reschedule`, { date, start_time: time, mark_confirmed: confirmed });
      toast.success(`Moved to ${fmtDate(date)} at ${fmtTime(time)}`);
      onDone();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} wide title="Reschedule appointment" subtitle={`${appt.patient.full_name} · currently ${fmtDate(appt.date)} at ${fmtTime(appt.start_time)} with ${appt.doctor.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!date || !time} loading={busy} onClick={save}>Move appointment</Button></>}>
      {err && <Notice tone="danger" className="mb-3">{err}</Notice>}
      <SlotPicker slotsPath="/appointments/slots" doctorId={appt.doctor.id} today={today} days={35} date={date} time={time} onChange={(d, t) => { setDate(d); setTime(t); }} />
      <div className="mt-4">
        <Checkbox checked={confirmed} onChange={setConfirmed} label="Patient agreed to the new time (mark as confirmed)" description="Untick if the patient still needs to confirm — they'll get a day-before reminder with Confirm / Reschedule." />
      </div>
    </Modal>
  );
}
