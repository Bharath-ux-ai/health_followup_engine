"use client";

import { useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { useToast } from "@/components/providers";
import { Badge } from "@/components/status";
import { Button, Card, ErrorState, Field, Input, Loading, Modal, Notice, Select, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useData } from "@/lib/hooks";

interface Template { id: string; purpose: string; language: "en" | "ta"; meta_name: string | null; meta_language_code: string | null; body: string; confirm_label: string | null; reschedule_label: string | null; approval_status: string; last_synced_at: string | null }
interface Payload { items: Template[]; parameters: Record<string, string[]>; reply_placeholders: string[] }

const PURPOSE: Record<string, [string, string]> = {
  appointment_reminder: ["Appointment reminder", "Sent the day before the visit, with Confirm / Reschedule buttons"],
  followup_reminder: ["Follow-up reminder", "Sent 7 and 3 days before the follow-up date"],
  appointment_confirmed_reply: ["Reply: appointment confirmed", "After the patient taps Confirm"],
  appointment_reschedule_reply: ["Reply: choose a new time", "After the patient taps Reschedule"],
  followup_booked_reply: ["Reply: follow-up booked", "After Confirm on a follow-up reminder"],
  followup_reschedule_reply: ["Reply: pick follow-up date", "After Reschedule on a follow-up reminder"],
  rescheduled_reply: ["Reply: rescheduled", "After the patient picks a new time from the link"],
};
const APPROVAL: Record<string, [string, "ok" | "warn" | "danger" | "neutral" | "info"]> = {
  approved: ["Approved by Meta", "ok"], pending: ["Pending review", "warn"], rejected: ["Rejected", "danger"], not_submitted: ["Not submitted", "neutral"], not_required: ["No approval needed", "info"],
};
const SAMPLE: Record<string, string> = { patient_name: "Ravi", hospital_name: "your hospital", doctor_name: "Dr. Arun Kumar", date: "Wed, 11 Nov", time: "10:30 AM", days: "7", name: "Ravi", hospital: "your hospital", doctor: "Dr. Arun Kumar", reference: "TT-7KQ2MX", link: "https://…/r/…" };

export default function TemplatesPage() {
  const toast = useToast();
  const { data, error, reload } = useData(() => api.get<Payload>("/whatsapp/templates"), []);
  const [edit, setEdit] = useState<Template | null>(null);
  const [syncing, setSyncing] = useState(false);
  if (!data) return error ? <ErrorState text={error} onRetry={reload} /> : <Loading />;

  const preview = (t: Template) => {
    const params = data.parameters[t.purpose];
    return params ? t.body.replace(/\{\{(\d+)\}\}/g, (m, n) => SAMPLE[params[Number(n) - 1]] ?? m) : t.body.replace(/\{(\w+)\}/g, (m, k) => SAMPLE[k] ?? m);
  };
  const purposes = Object.keys(PURPOSE);

  return (
    <div className="space-y-4">
      <Notice tone="info" title="How templates work">
        Reminders start the conversation, so WhatsApp requires <b>pre-approved templates</b>: create each one in WhatsApp Manager with the exact name, language and text below (quick-reply buttons: Confirm, Reschedule), then sync. Replies after a patient taps a button are free-form and need no approval. Tamil wording should be reviewed by the marketing team before submission.
      </Notice>
      <div className="flex justify-end">
        <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={syncing} onClick={async () => {
          setSyncing(true);
          try { const r = await api.post<{ updated: number; remote_templates: number }>("/whatsapp/templates/sync"); toast.success(`Synced: ${r.remote_templates} templates found in WhatsApp Manager`); reload(); }
          catch (e) { toast.error(errorMessage(e)); } finally { setSyncing(false); }
        }}>Sync approval status</Button>
      </div>
      {purposes.map((p) => {
        const items = data.items.filter((t) => t.purpose === p);
        if (!items.length) return null;
        return (
          <Card key={p}>
            <div className="border-b border-silver px-5 py-3">
              <h3 className="font-bold">{PURPOSE[p][0]}</h3>
              <p className="text-[13px] text-muted">{PURPOSE[p][1]}{data.parameters[p] && <> · variables: {data.parameters[p].map((v, i) => `{{${i + 1}}} ${v.replace("_", " ")}`).join(", ")}</>}</p>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              {items.map((t) => (
                <div key={t.id} className="flex flex-col rounded-xl border border-silver">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-silver px-4 py-2.5">
                    <span className="text-sm font-bold">{t.language === "ta" ? "தமிழ் · Tamil" : "English"}</span>
                    <Badge tone={APPROVAL[t.approval_status][1]}>{APPROVAL[t.approval_status][0]}</Badge>
                  </div>
                  <div className="wa-wall flex-1 p-4">
                    <div className="max-w-[95%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-[13px] whitespace-pre-line shadow-sm" lang={t.language}>{preview(t)}</div>
                    {t.confirm_label && (
                      <div className="mt-1 grid max-w-[95%] grid-cols-2 gap-1 text-center text-[12px] font-semibold text-[#008069]">
                        <span className="rounded-lg bg-white py-1.5 shadow-sm" lang={t.language}>{t.confirm_label}</span>
                        <span className="rounded-lg bg-white py-1.5 shadow-sm" lang={t.language}>{t.reschedule_label}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs text-muted">
                    <span>{t.meta_name ? <>Meta name <code className="text-ink">{t.meta_name}</code> · {t.meta_language_code}</> : "Session reply"}</span>
                    <Button size="sm" variant="secondary" onClick={() => setEdit(t)}>Edit</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
      {edit && <Editor t={edit} params={data.parameters[edit.purpose]} placeholders={data.reply_placeholders} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}

function Editor({ t, params, placeholders, onClose, onSaved }: { t: Template; params?: string[]; placeholders: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState(t.body);
  const [name, setName] = useState(t.meta_name || "");
  const [c, setC] = useState(t.confirm_label || "");
  const [r, setR] = useState(t.reschedule_label || "");
  const [approval, setApproval] = useState(t.approval_status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isMeta = !!params;
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/whatsapp/templates/${t.id}`, isMeta ? { body, meta_name: name, confirm_label: c, reschedule_label: r, approval_status: body !== t.body ? undefined : approval } : { body });
      toast.success("Template saved");
      onSaved();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    try { await api.post(`/whatsapp/templates/reset/${t.id}`); toast.success("Restored default text"); onSaved(); onClose(); } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <Modal open onClose={onClose} wide title={`Edit ${PURPOSE[t.purpose][0]} (${t.language === "ta" ? "Tamil" : "English"})`}
      footer={<><Button variant="ghost" className="mr-auto" icon={<RotateCcw className="size-4" />} onClick={reset}>Restore default</Button><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      {err && <Notice tone="danger" className="mb-3">{err}</Notice>}
      <div className="space-y-4">
        <Field label="Message text" hint={isMeta ? `Variables: ${params!.map((p, i) => `{{${i + 1}}} = ${p.replace("_", " ")}`).join(" · ")}. Changing the text resets approval.` : `Placeholders: ${placeholders.map((p) => `{${p}}`).join(" ")}`}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} lang={t.language} maxLength={1024} />
        </Field>
        {isMeta && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Template name in WhatsApp Manager" hint="lowercase, numbers and _"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Approval status" hint="Use Sync to read it from Meta">
              <Select value={approval} onChange={(e) => setApproval(e.target.value)}>
                {["not_submitted", "pending", "approved", "rejected"].map((s) => <option key={s} value={s}>{APPROVAL[s][0]}</option>)}
              </Select>
            </Field>
            <Field label="Confirm button label"><Input value={c} onChange={(e) => setC(e.target.value)} maxLength={20} lang={t.language} /></Field>
            <Field label="Reschedule button label"><Input value={r} onChange={(e) => setR(e.target.value)} maxLength={20} lang={t.language} /></Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
