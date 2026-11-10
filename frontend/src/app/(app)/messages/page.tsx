"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCheck, ChevronLeft, FlaskConical, MessageCircle, RefreshCw, Search, Send, Stethoscope } from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { RescheduleFlow } from "@/components/reschedule-flow";
import { Badge, MessageStatusLabel, REMINDER_KIND } from "@/components/status";
import { Button, Card, EmptyState, ErrorState, Input, Loading, Modal, Notice, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cx, fmtDateTime, fmtPhone, fmtTimeOfIso, localDateOfIso, fmtDate } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Message, PatientBrief, Reminder } from "@/lib/types";

interface Conversations {
  items: { patient: PatientBrief; last_at: string; count: number; last_message: { body: string; direction: string; status: string } | null; awaiting_reply: boolean }[];
  mode: "simulation" | "live";
  hospital: { name: string; phone: string | null };
}
interface Conversation { patient: PatientBrief; messages: Message[]; mode: string }

function MessagesInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<"chats" | "log" | "failed">((sp.get("tab") as "failed") || "chats");
  const [selected, setSelected] = useState<string | null>(sp.get("patient"));
  const [q, setQ] = useState("");
  const convos = useData(() => api.get<Conversations>("/messages/conversations", { q }), [q]);

  // On wide screens the first conversation opens automatically; on phones the list shows until one is tapped.
  const shown = selected || convos.data?.items[0]?.patient.id || null;

  const live = convos.data?.mode === "live";
  return (
    <div className="space-y-5">
      <PageHeader title="WhatsApp Messages" subtitle="Reminders, patient replies and delivery status" />
      {convos.data && (live ? (
        <Notice tone="ok" title="Live — WhatsApp Business Platform">Messages are sent through the Cloud API. Statuses (sent, delivered, read) come from WhatsApp webhooks. Real patients reply on their own phones.</Notice>
      ) : (
        <Notice tone="violet" title={<span className="flex items-center gap-2"><FlaskConical className="size-4" /> Simulation mode — nothing is sent through WhatsApp</span>}>
          Messages appear only in this simulator, marked &ldquo;simulated&rdquo;. Tap Confirm or Reschedule to play the patient. Connect a WhatsApp Business number in Settings → WhatsApp to go live.
        </Notice>
      ))}
      <Tabs value={tab} onChange={(v) => { setTab(v); router.replace(`/messages?tab=${v}`); }} items={[{ value: "chats", label: "Conversations" }, { value: "log", label: "Delivery log" }, { value: "failed", label: "Failed reminders" }]} />
      {tab === "chats" && (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Card className={cx("overflow-hidden", selected && "max-lg:hidden")}>
            <div className="border-b border-silver p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patients" className="h-9 pl-9" aria-label="Search conversations" />
              </div>
            </div>
            {convos.error ? <ErrorState text={convos.error} onRetry={convos.reload} /> : !convos.data ? <Loading /> : convos.data.items.length ? (
              <ul className="max-h-[640px] divide-y divide-silver overflow-y-auto">
                {convos.data.items.map((c) => (
                  <li key={c.patient.id}>
                    <button onClick={() => setSelected(c.patient.id)} className={cx("flex w-full items-start gap-3 px-4 py-3 text-left transition-colors", shown === c.patient.id ? "bg-violet-50" : "hover:bg-off")}>
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#dfe5e7] text-sm font-bold text-ink-2">{c.patient.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-bold">{c.patient.full_name}</span>
                          <span className="shrink-0 text-[11px] text-muted">{fmtDate(localDateOfIso(c.last_at), { day: "numeric", month: "short" })}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <span className="truncate text-xs text-muted" lang={c.patient.preferred_language}>{c.last_message?.direction === "inbound" ? "↩ " : ""}{c.last_message?.body}</span>
                          {c.awaiting_reply && <span className="ml-auto size-2 shrink-0 rounded-full bg-[#25d366]" title="Awaiting patient reply" />}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<MessageCircle className="size-5" />} title="No messages yet" text="Reminders appear here when they are sent — the day before visits and 7 & 3 days before follow-ups." />
            )}
          </Card>
          {shown ? (
            <div className={cx(!selected && "max-lg:hidden")}>
              <Chat key={shown} patientId={shown} hospital={convos.data?.hospital} onBack={() => setSelected(null)} onChanged={convos.reload} />
            </div>
          ) : (
            <Card className="hidden place-items-center lg:grid"><EmptyState icon={<MessageCircle className="size-5" />} title="Select a conversation" /></Card>
          )}
        </div>
      )}
      {tab === "log" && <DeliveryLog />}
      {tab === "failed" && <FailedReminders />}
    </div>
  );
}

function Chat({ patientId, hospital, onBack, onChanged }: { patientId: string; hospital?: { name: string; phone: string | null }; onBack: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const tz = me?.hospital?.timezone;
  const { data, error, reload } = useData(() => api.get<Conversation>(`/messages/conversations/${patientId}`), [patientId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const live = data?.mode === "live";

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [data?.messages.length]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(reload, 10000); // pick up webhook replies and delivery receipts
    return () => clearInterval(t);
  }, [live, reload]);

  async function tap(m: Message, action: "CONFIRM" | "RESCHEDULE") {
    setBusy(m.id + action);
    try {
      const r = await api.post<{ result: string; action_url?: string }>("/messages/simulate-tap", { message_id: m.id, action });
      const labels: Record<string, string> = {
        appointment_confirmed: "Appointment confirmed — dashboard updated",
        reschedule_requested: "Reschedule requested — the patient got a link to pick a new time",
        followup_booked: "Follow-up visit booked automatically",
        followup_reschedule_requested: "Patient asked for another date",
        followup_confirmed_no_slot: "Confirmed — no free slot that day, patient asked to choose a time",
        already_recorded: "Already answered",
      };
      toast.success(labels[r.result] || "Response recorded");
      await reload();
      onChanged();
      if (r.action_url) setToken(r.action_url.split("/r/")[1]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <Card><ErrorState text={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading /></Card>;

  const days = data.messages.map((m) => localDateOfIso(m.occurred_at, tz));
  return (
    <Card className="flex min-h-[560px] flex-col overflow-hidden">
      <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
        <button onClick={onBack} className="lg:hidden" aria-label="Back to conversations"><ChevronLeft className="size-5" /></button>
        <span className="grid size-10 place-items-center rounded-full bg-white/15"><Stethoscope className="size-5" /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5 truncate font-semibold">{hospital?.name || me?.hospital?.name} <span className="rounded bg-white/20 px-1 text-[10px]">Business</span></div>
          <div className="truncate text-[12px] text-white/75">Patient view · {data.patient.full_name} · {fmtPhone(data.patient.phone)}</div>
        </div>
        <Link href={`/patients/${data.patient.id}`} className="rounded-md px-2 py-1 text-xs font-semibold text-white/90 hover:bg-white/10">Patient record</Link>
        <button onClick={reload} aria-label="Refresh" className="rounded-md p-1.5 hover:bg-white/10"><RefreshCw className="size-4" /></button>
      </div>
      {!live && <div className="bg-violet-50 px-4 py-1.5 text-center text-[11px] font-semibold text-violet-800">SIMULATOR — what {data.patient.full_name.split(" ")[0]} would see. Not delivered via WhatsApp.</div>}
      {data.patient.is_demo && live && <div className="bg-violet-50 px-4 py-1.5 text-center text-[11px] font-semibold text-violet-800">Fictional demo patient — always simulated, never messaged.</div>}
      <div className="wa-wall flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-6" style={{ maxHeight: 620 }}>
        {data.messages.map((m, i) => {
          const day = days[i];
          const showDay = i === 0 || day !== days[i - 1];
          const fromHospital = m.direction === "outbound";
          const answerable = !!m.answerable && !live;
          const actionUrl = m.meta?.action_url;
          return (
            <div key={m.id}>
              {showDay && <div className="my-3 text-center"><span className="rounded-md bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-ink-2 shadow-sm">{fmtDate(day, { weekday: "long", day: "numeric", month: "long" })}</span></div>}
              <div className={cx("flex", fromHospital ? "justify-start" : "justify-end")}>
                <div className={cx("animate-rise max-w-[85%] sm:max-w-[70%]")}>
                  <div className={cx("relative rounded-lg px-3 pt-2 pb-1.5 text-[14px] leading-snug shadow-sm", fromHospital ? "rounded-tl-none bg-white" : "rounded-tr-none bg-[#d9fdd3]", m.status === "failed" && "ring-1 ring-danger")}>
                    {m.meta?.reminder_kind && <div className="mb-1 text-[11px] font-bold text-[#075e54]">{REMINDER_KIND[m.meta.reminder_kind as Reminder["kind"]]}</div>}
                    <p className="whitespace-pre-line text-ink" lang={m.language === "ta" ? "ta" : undefined}>{linkify(m.body)}</p>
                    <div className="mt-1 flex items-center justify-end gap-1 text-[10.5px] text-muted">
                      {m.is_simulated && <span className="font-semibold text-violet-800">simulated ·</span>}
                      {fmtTimeOfIso(m.occurred_at, tz)}
                      {fromHospital && <Ticks status={m.status} />}
                    </div>
                  </div>
                  {m.buttons.length > 0 && (
                    <div className="mt-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${m.buttons.length}, 1fr)` }}>
                      {m.buttons.map((b) => {
                        const chosen = (m.reminder_response === "confirmed" && b.action === "CONFIRM") || (m.reminder_response === "reschedule_requested" && b.action === "RESCHEDULE");
                        return (
                          <button key={b.action} disabled={!answerable || !!busy} onClick={() => tap(m, b.action)}
                            title={live ? "The patient taps this on their phone" : answerable ? `Simulate the patient tapping ${b.label}` : "Already answered"}
                            className={cx("rounded-lg bg-white px-2 py-2 text-[13px] font-semibold shadow-sm transition-colors", chosen ? "text-[#008069] ring-2 ring-[#25d366]" : "text-[#008069]", answerable && "hover:bg-[#f0fdf4]", !answerable && !chosen && "opacity-60")}>
                            {busy === m.id + b.action ? "…" : b.label}{chosen && " ✓"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {actionUrl && fromHospital && !live && (
                    <button onClick={() => setToken(actionUrl.split("/r/")[1])} className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-[13px] font-semibold text-[#008069] shadow-sm hover:bg-[#f0fdf4]">
                      Open link · choose a time
                    </button>
                  )}
                  {m.status === "failed" && <p className="mt-1 text-[11px] text-danger"><AlertTriangle className="mr-1 inline size-3" />{m.error_message || "Failed"}</p>}
                </div>
              </div>
            </div>
          );
        })}
        {!data.messages.length && <EmptyState title="No messages yet" />}
        <div ref={end} />
      </div>
      <div className="flex items-center gap-2 border-t border-silver bg-[#f0f2f5] px-4 py-2.5 text-xs text-muted">
        <Send className="size-4" /> Business-initiated messages use Meta-approved templates. Free replies are only allowed within 24 hours of the patient&apos;s last message.
      </div>
      <Modal open={!!token} onClose={() => setToken(null)} title="Patient's reschedule page" subtitle="This is the page the patient opens from the WhatsApp link" wide>
        {token && <RescheduleFlow token={token} onDone={() => { reload(); onChanged(); toast.success("Appointment updated — dashboard and conversation refreshed"); }} />}
      </Modal>
    </Card>
  );
}

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return parts.map((p, i) => (p.startsWith("http") ? <span key={i} className="break-all text-[#027eb5] underline">{p.length > 48 ? p.slice(0, 46) + "…" : p}</span> : p));
}

function Ticks({ status }: { status: string }) {
  if (status === "read") return <CheckCheck className="size-3.5 text-[#53bdeb]" />;
  if (status === "delivered") return <CheckCheck className="size-3.5" />;
  if (status === "sent") return <Check className="size-3.5" />;
  if (status === "failed") return <AlertTriangle className="size-3 text-danger" />;
  return null;
}

function DeliveryLog() {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useData(() => api.get<{ items: Message[]; total: number }>("/messages", { status: status ? [status] : undefined, page_size: 100 }), [status]);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-silver p-4">
        {["", "simulated", "sent", "delivered", "read", "failed", "received"].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cx("rounded-full border px-3 py-1 text-[12px] font-semibold", status === s ? "border-ink bg-ink text-white" : "border-silver-2")}>{s || "All"}</button>
        ))}
        <span className="ml-auto text-xs text-muted">{data?.total ?? 0} messages</span>
      </div>
      {error ? <ErrorState text={error} onRetry={reload} /> : !data ? <Loading /> : data.items.length ? (
        <Table>
          <thead><tr><Th>Time</Th><Th>Patient</Th><Th>Type</Th><Th>Status</Th><Th>Details</Th></tr></thead>
          <tbody>
            {data.items.map((m) => (
              <tr key={m.id}>
                <Td className="tabular text-xs whitespace-nowrap">{fmtDateTime(m.occurred_at)}</Td>
                <Td className="text-[13px] font-semibold">{m.patient_name || "—"}</Td>
                <Td className="text-[13px]">{m.direction === "inbound" ? "Patient reply" : m.meta?.reminder_kind ? REMINDER_KIND[m.meta.reminder_kind as Reminder["kind"]] : m.purpose === "connection_test" ? "Connection test" : "Reply"}<span className="ml-1 text-xs text-muted">{m.language?.toUpperCase()}</span></Td>
                <Td><MessageStatusLabel status={m.status} /></Td>
                <Td className="max-w-[320px] truncate text-xs text-muted" title={m.error_message || m.body}>{m.error_message || m.body}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <EmptyState title="No messages" />}
    </Card>
  );
}

function FailedReminders() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, error, reload } = useData(() => api.get<(Reminder & { patient: PatientBrief })[]>("/messages/reminders/failed"), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<(Reminder & { patient: PatientBrief }) | null>(null);
  async function retry(r: Reminder, confirm = false) {
    setBusy(r.id);
    try {
      const out = await api.post<Reminder>(`/messages/reminders/${r.id}/retry`, { confirm_uncertain: confirm });
      if (out.status === "sent") toast.success("Reminder sent");
      else toast.error(`Still failing: ${out.last_error || out.status}`);
      setUncertain(null);
      reload();
    } catch (e) {
      if ((e as { code?: string }).code === "uncertain") setUncertain(r as Reminder & { patient: PatientBrief });
      else toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card>
      {error ? <ErrorState text={error} onRetry={reload} /> : !data ? <Loading /> : data.length ? (
        <Table>
          <thead><tr><Th>Patient</Th><Th>Reminder</Th><Th>Error</Th><Th>Attempts</Th><Th className="text-right">Action</Th></tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/patients/${r.patient.id}`} className="font-semibold hover:underline">{r.patient.full_name}</Link><span className="tabular block text-xs text-muted">{fmtPhone(r.patient.phone)}</span></Td>
                <Td className="text-[13px]">{REMINDER_KIND[r.kind]}<span className="block text-xs text-muted">for {fmtDate(r.target_date)}</span></Td>
                <Td className="max-w-[340px] text-xs text-danger">{r.delivery_uncertain && <Badge tone="warn" className="mr-1">Delivery unknown</Badge>}{r.last_error}</Td>
                <Td className="tabular">{r.attempts}</Td>
                <Td className="text-right">{can("messages.retry") && <Button size="sm" variant="secondary" loading={busy === r.id} onClick={() => retry(r)}>Retry</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <EmptyState icon={<CheckCheck className="size-5" />} title="No failed reminders" text="Failed sends are retried automatically (up to 3 times). Anything that still fails appears here." />}
      <Modal open={!!uncertain} onClose={() => setUncertain(null)} title="Delivery status unknown"
        footer={<><Button variant="secondary" onClick={() => setUncertain(null)}>Cancel</Button><Button loading={!!busy} onClick={() => uncertain && retry(uncertain, true)}>Patient did not receive it — resend</Button></>}>
        <p className="text-sm text-ink-2">WhatsApp did not answer in time, so this reminder may already have reached {uncertain?.patient.full_name}. To avoid a duplicate, check with the patient (or the WhatsApp Manager) before resending.</p>
      </Modal>
    </Card>
  );
}

export default function MessagesPage() {
  return <Suspense fallback={<Loading />}><MessagesInner /></Suspense>;
}
