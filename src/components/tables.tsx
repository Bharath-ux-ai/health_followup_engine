"use client";

import Link from "next/link";
import { useState } from "react";
import { Ban, Check, CheckCheck, ChevronRight, Phone, PhoneCall, UserX } from "lucide-react";
import { AppointmentBadge, Badge, FollowUpBadge, ReminderBadge } from "@/components/status";
import { useToast } from "@/components/providers";
import { Button, Field, Modal, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cx, fmtDate, fmtDateTime, fmtPhone, fmtTime, relativeDays } from "@/lib/format";
import type { Appointment, AppointmentStatus, FollowUp } from "@/lib/types";

export function PatientCell({ p, href }: { p: Appointment["patient"]; href?: string }) {
  const inner = (
    <>
      <span className="flex items-center gap-1.5 font-semibold text-ink">
        {p.full_name}
        {p.is_demo && <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">DEMO</span>}
      </span>
      <span className="tabular block text-xs whitespace-nowrap text-muted">{fmtPhone(p.phone)}{p.preferred_language === "ta" && " · தமிழ்"}</span>
    </>
  );
  return href ? <Link href={href} className="block hover:[&>span:first-child]:text-violet-800">{inner}</Link> : <div>{inner}</div>;
}

export function useStatusAction(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function setStatus(a: Appointment, status: AppointmentStatus, reason?: string) {
    setBusy(a.id + status);
    try {
      await api.post(`/appointments/${a.id}/status`, { status, reason });
      const verb: Record<string, string> = { confirmed: "confirmed", completed: "marked as completed", no_show: "marked as no-show", cancelled: "cancelled" };
      toast.success(`${a.patient.full_name}'s appointment ${verb[status] || "updated"}`);
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return { busy, setStatus };
}

export function AppointmentsTable({ items, today, onChanged, showDate = false, compact = false }: { items: Appointment[]; today: string; onChanged: () => void; showDate?: boolean; compact?: boolean }) {
  const { busy, setStatus } = useStatusAction(onChanged);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [reason, setReason] = useState("");
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>{showDate ? "Date & time" : "Time"}</Th>
            <Th>Patient</Th>
            {!compact && <Th>Doctor</Th>}
            <Th>Status</Th>
            <Th>WhatsApp reminder</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => {
            const past = a.date <= today;
            const active = ["booked", "confirmed", "reschedule_requested"].includes(a.status);
            return (
              <tr key={a.id} className={cx("group hover:bg-off/60", a.status === "reschedule_requested" && "bg-violet-50/40")}>
                <Td className="tabular whitespace-nowrap">
                  {showDate && <span className="block text-xs text-muted">{fmtDate(a.date)}</span>}
                  <span className="font-semibold">{fmtTime(a.start_time)}</span>
                  <span className="block font-mono text-[11px] text-muted">{a.reference}</span>
                </Td>
                <Td><PatientCell p={a.patient} href={`/patients/${a.patient.id}`} /></Td>
                {!compact && (
                  <Td>
                    <span className="block font-medium">{a.doctor.name}</span>
                    <span className="block text-xs text-muted">{a.source === "followup" ? "Follow-up visit" : a.source === "online" ? "Online booking" : "Reception"}</span>
                  </Td>
                )}
                <Td><AppointmentBadge status={a.status} /></Td>
                <Td><ReminderBadge r={a.reminder} /></Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {active && a.status !== "confirmed" && (
                      <Button size="sm" variant="secondary" icon={<Check className="size-3.5" />} loading={busy === a.id + "confirmed"} onClick={() => setStatus(a, "confirmed")} title="Patient confirmed by phone">
                        Confirm
                      </Button>
                    )}
                    {active && past && (
                      <>
                        <Button size="sm" variant="success" icon={<CheckCheck className="size-3.5" />} loading={busy === a.id + "completed"} onClick={() => setStatus(a, "completed")}>
                          Visited
                        </Button>
                        <Button size="sm" variant="ghost" icon={<UserX className="size-3.5" />} loading={busy === a.id + "no_show"} onClick={() => setStatus(a, "no_show")} title="Mark no-show">
                          <span className="sr-only sm:not-sr-only">No-show</span>
                        </Button>
                      </>
                    )}
                    {active && !past && (
                      <Button size="sm" variant="ghost" icon={<Ban className="size-3.5" />} onClick={() => { setCancelling(a); setReason(""); }} title="Cancel appointment">
                        <span className="sr-only">Cancel</span>
                      </Button>
                    )}
                    <Link href={`/appointments/${a.id}`} className="grid size-8 place-items-center rounded-lg text-slate hover:bg-silver/60 hover:text-ink" aria-label="Open appointment">
                      <ChevronRight className="size-4" />
                    </Link>
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Modal
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title="Cancel appointment?"
        subtitle={cancelling ? `${cancelling.patient.full_name} · ${fmtDate(cancelling.date)} at ${fmtTime(cancelling.start_time)}` : ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(null)}>Keep appointment</Button>
            <Button variant="danger" loading={!!busy} onClick={async () => { if (cancelling) { await setStatus(cancelling, "cancelled", reason || undefined); setCancelling(null); } }}>
              Cancel appointment
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">The slot is released immediately and any pending reminder is stopped.</p>
        <Field label="Reason (optional)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Patient called to cancel" />
        </Field>
      </Modal>
    </>
  );
}

// ---- follow-ups --------------------------------------------------------------------------------
export const CONTACT_OUTCOMES: Record<string, string> = {
  reached: "Spoke to patient",
  will_visit: "Patient will visit",
  no_answer: "No answer",
  wrong_number: "Wrong number",
  declined: "Patient declined",
};

export function ReminderChips({ fu }: { fu: FollowUp }) {
  const rs = fu.reminders.filter((r) => r.kind !== "appointment_1d");
  if (!rs.length) return <span className="text-xs text-slate">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {rs.map((r) => {
        const sent = r.status === "sent";
        const label = r.kind === "followup_7d" ? "7d" : "3d";
        return (
          <span
            key={r.id}
            title={`${label} reminder · ${r.status}${r.sent_at ? " · " + fmtDateTime(r.sent_at) : r.skip_reason ? " · " + r.skip_reason : " · due " + fmtDateTime(r.scheduled_for)}`}
            className={cx(
              "tabular rounded-md px-1.5 py-0.5 text-[11px] font-bold",
              r.response === "confirmed" ? "bg-ok-50 text-ok" : r.response ? "bg-violet-50 text-violet-800" : sent ? (r.simulated ? "bg-violet-50 text-violet-800" : "bg-info-50 text-info") : r.status === "failed" ? "bg-danger-50 text-danger" : r.status === "pending" ? "bg-silver/80 text-ink-2" : "bg-off text-slate line-through",
            )}
          >
            {label} {sent ? "✓" : r.status === "pending" ? "·" : ""}
          </span>
        );
      })}
    </div>
  );
}

export function LogContactModal({ fu, onClose, onSaved }: { fu: FollowUp | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState("reached");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!fu) return;
    setBusy(true);
    try {
      await api.post(`/followups/${fu.id}/contact`, { outcome, note: note || null });
      toast.success(`Contact with ${fu.patient.full_name} recorded`);
      setNote("");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={!!fu} onClose={onClose} title="Mark as contacted" subtitle={fu ? `${fu.patient.full_name} · follow-up ${fmtDate(fu.due_date)}` : ""}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save contact</Button></>}>
      {fu && (
        <a href={`tel:${fu.patient.phone}`} className="mb-4 flex items-center justify-between rounded-xl border border-silver bg-off px-4 py-3 hover:border-violet">
          <span>
            <span className="block text-xs text-muted">Call patient</span>
            <span className="tabular font-bold">{fmtPhone(fu.patient.phone)}</span>
          </span>
          <PhoneCall className="size-5 text-violet-700" />
        </a>
      )}
      <div className="space-y-4">
        <Field label="Outcome">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {Object.entries(CONTACT_OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Note (optional)" hint="Keep it short — no medical details.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} placeholder="e.g. Will come on Friday morning" />
        </Field>
      </div>
    </Modal>
  );
}

export function FollowUpsTable({ items, today, onChanged, onBook }: { items: FollowUp[]; today: string; onChanged: () => void; onBook?: (fu: FollowUp) => void }) {
  const [contact, setContact] = useState<FollowUp | null>(null);
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Patient</Th>
            <Th>Follow-up date</Th>
            <Th>Doctor</Th>
            <Th>Status</Th>
            <Th>Reminders</Th>
            <Th>Last contact</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((f) => {
            const red = !!f.attention;
            const open = ["scheduled", "missed"].includes(f.status);
            return (
              <tr key={f.id} className={cx(red ? "bg-danger-50/70 hover:bg-danger-50" : "hover:bg-off/60")}>
                <Td className={cx(red && "border-l-4 border-l-danger")}><PatientCell p={f.patient} href={`/patients/${f.patient.id}`} /></Td>
                <Td className="whitespace-nowrap">
                  <span className={cx("tabular font-semibold", red && "text-danger")}>{fmtDate(f.due_date)}</span>
                  <span className={cx("block text-xs", red ? "text-danger" : "text-muted")}>{relativeDays(f.due_date, today)}</span>
                  {f.visit && ["booked", "confirmed"].includes(f.visit.status) && <span className="block text-xs text-ok">Visit {fmtTime(f.visit.start_time)} · {f.visit.reference}</span>}
                </Td>
                <Td className="text-[13px]">{f.doctor.name}</Td>
                <Td><FollowUpBadge fu={f} /></Td>
                <Td><ReminderChips fu={f} /></Td>
                <Td className="text-xs text-muted">{f.last_contacted_at ? <>{fmtDateTime(f.last_contacted_at)}<span className="block">{f.contact_count} attempt{f.contact_count === 1 ? "" : "s"}</span></> : "—"}</Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <a href={`tel:${f.patient.phone}`} className="grid size-8 place-items-center rounded-lg text-slate hover:bg-silver/60 hover:text-ink" aria-label={`Call ${f.patient.full_name}`} title="Call">
                      <Phone className="size-4" />
                    </a>
                    {open && (
                      <Button size="sm" variant={red ? "primary" : "secondary"} onClick={() => setContact(f)}>Contacted</Button>
                    )}
                    {open && onBook && <Button size="sm" variant="secondary" onClick={() => onBook(f)}>Book visit</Button>}
                    <Link href={`/follow-ups?id=${f.id}`} className="grid size-8 place-items-center rounded-lg text-slate hover:bg-silver/60 hover:text-ink" aria-label="Open follow-up">
                      <ChevronRight className="size-4" />
                    </Link>
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <LogContactModal fu={contact} onClose={() => setContact(null)} onSaved={onChanged} />
    </>
  );
}

export function SourceBadge({ source }: { source: Appointment["source"] }) {
  return <Badge tone="neutral">{source === "online" ? "Online" : source === "followup" ? "Follow-up" : "Reception"}</Badge>;
}
