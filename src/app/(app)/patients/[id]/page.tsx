"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, CalendarPlus, Edit3, MessageCircle, Phone, PhoneCall, RotateCcw, ShieldCheck } from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { BookVisitModal } from "@/components/book-visit-modal";
import { Badge } from "@/components/status";
import { AppointmentsTable, CONTACT_OUTCOMES, FollowUpsTable } from "@/components/tables";
import { Button, Card, CardHeader, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, Select } from "@/components/ui";
import { PatientTimeline } from "@/components/patient-timeline";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtPhone } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Appointment, Contact, FollowUp, Patient } from "@/lib/types";

type Detail = Patient & { appointments: Appointment[]; followups: FollowUp[]; contacts: Contact[]; message_count: number };

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useAuth();
  const today = me?.hospital?.today || "";
  const { data: p, error, loading, reload } = useData(() => api.get<Detail>(`/patients/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  const [booking, setBooking] = useState<FollowUp | null>(null);

  if (!p) return loading ? <Loading /> : <ErrorState text={error || "Patient not found"} onRetry={reload} />;
  const red = p.followups.filter((f) => f.attention);

  return (
    <div className="space-y-6">
      <Link href="/patients" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" /> Patients</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid size-14 place-items-center rounded-2xl bg-ink text-lg font-bold text-white">{p.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</div>
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-[26px] font-bold tracking-tight">
              {p.full_name} {p.is_demo && <Badge tone="violet">Demo patient</Badge>}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              <a href={`tel:${p.phone}`} className="tabular flex items-center gap-1.5 font-semibold text-ink hover:underline"><Phone className="size-3.5" />{fmtPhone(p.phone)}</a>
              <span>{p.preferred_language === "ta" ? "Tamil" : "English"} messages</span>
              {p.whatsapp_consent ? <Badge tone="ok"><ShieldCheck className="size-3" /> WhatsApp consent</Badge> : <Badge>No WhatsApp consent</Badge>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/messages?patient=${p.id}`}><Button variant="secondary" icon={<MessageCircle className="size-4" />}>Conversation ({p.message_count})</Button></Link>
          {can("patients.manage") && <Button variant="secondary" icon={<Edit3 className="size-4" />} onClick={() => setEdit(true)}>Edit</Button>}
          {can("appointments.manage") && <Link href="/book-appointment"><Button icon={<CalendarPlus className="size-4" />}>New appointment</Button></Link>}
        </div>
      </div>

      {red.length > 0 && (
        <Notice tone="danger" title={red[0].attention === "overdue" ? "Follow-up overdue — no visit recorded" : "No response to follow-up reminders"}>
          Call {p.full_name.split(" ")[0]} on <a href={`tel:${p.phone}`} className="font-semibold underline">{fmtPhone(p.phone)}</a>, then mark the follow-up as contacted or book the visit.
        </Notice>
      )}

      {/* Visual Patient Journey Timeline */}
      <PatientTimeline
        patient={p}
        appointments={p.appointments}
        followups={p.followups}
        contacts={p.contacts}
      />

      <Card>
        <CardHeader icon={<RotateCcw className="size-5" />} title="Follow-ups" subtitle="Set from a visit — open a past appointment below to add one" />
        {p.followups.length ? (
          <FollowUpsTable items={p.followups} today={today} onChanged={reload} onBook={can("appointments.manage") ? setBooking : undefined} />
        ) : (
          <EmptyState title="No follow-ups" text="Open a completed appointment and enter the next follow-up date." />
        )}
      </Card>

      <Card>
        <CardHeader title="Appointments" subtitle="Previous and upcoming visits" />
        {p.appointments.length ? <AppointmentsTable items={p.appointments} today={today} onChanged={reload} showDate compact /> : <EmptyState title="No appointments" />}
      </Card>

      {p.contacts.length > 0 && (
        <Card>
          <CardHeader icon={<PhoneCall className="size-5" />} title="Contact history" />
          <ul className="divide-y divide-silver">
            {p.contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span><b>{CONTACT_OUTCOMES[c.outcome] || c.outcome}</b>{c.note && <span className="text-muted"> — {c.note}</span>}</span>
                <span className="text-xs text-muted">{fmtDateTime(c.contacted_at)}{c.by && ` · ${c.by}`}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-xs text-muted">Consent recorded {p.consent_at ? `${fmtDateTime(p.consent_at)} via ${p.consent_source?.replace("_", " ")}` : "— none"}. Viewing this record is logged for privacy.</p>

      <EditPatient open={edit} p={p} onClose={() => setEdit(false)} onSaved={reload} />
      <BookVisitModal fu={booking} today={today} onClose={() => setBooking(null)} onDone={reload} />
    </div>
  );
}

function EditPatient({ open, p, onClose, onSaved }: { open: boolean; p: Patient; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(p.full_name);
  const [phone, setPhone] = useState(p.phone);
  const [lang, setLang] = useState(p.preferred_language);
  const [consent, setConsent] = useState(p.whatsapp_consent);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/patients/${p.id}`, { full_name: name, phone, preferred_language: lang, whatsapp_consent: consent });
      toast.success("Patient updated");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Edit patient" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Mobile number"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Message language">
          <Select value={lang} onChange={(e) => setLang(e.target.value as "en" | "ta")}><option value="en">English</option><option value="ta">Tamil</option></Select>
        </Field>
        <Checkbox checked={consent} onChange={setConsent} label="Patient consents to WhatsApp reminders" description="Turning this off cancels any scheduled reminders immediately." />
      </div>
    </Modal>
  );
}
