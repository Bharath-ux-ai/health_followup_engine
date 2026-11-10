import { cx } from "@/lib/format";
import type { AppointmentStatus, FollowUp, FollowUpStatus, Reminder } from "@/lib/types";

type Tone = "neutral" | "violet" | "ok" | "warn" | "danger" | "info" | "dark";
const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-1 ring-slate-200/80",
  violet: "bg-violet-50 text-violet-700 ring-1 ring-violet-200/80",
  ok: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80",
  warn: "bg-amber-50 text-amber-800 ring-1 ring-amber-200/80",
  danger: "bg-rose-50 text-rose-700 ring-1 ring-rose-300 font-bold",
  info: "bg-blue-50 text-blue-700 ring-1 ring-blue-200/80",
  dark: "bg-slate-900 text-white shadow-xs",
};

export function Badge({ tone = "neutral", children, dot, className }: { tone?: Tone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold tracking-tight whitespace-nowrap shadow-xs", TONES[tone], className)}>
      {dot && (
        <span
          className={cx(
            "size-1.5 rounded-full",
            tone === "danger" ? "bg-rose-500 animate-pulse" : tone === "ok" ? "bg-emerald-500" : tone === "violet" ? "bg-violet-500" : tone === "warn" ? "bg-amber-500" : "bg-current",
          )}
        />
      )}
      {children}
    </span>
  );
}

const APPT: Record<AppointmentStatus, [string, Tone]> = {
  booked: ["Awaiting confirmation", "warn"],
  confirmed: ["Confirmed", "ok"],
  reschedule_requested: ["Wants to reschedule", "violet"],
  cancelled: ["Cancelled", "neutral"],
  completed: ["Completed", "info"],
  no_show: ["Missed (no-show)", "danger"],
};

export function AppointmentBadge({ status }: { status: AppointmentStatus }) {
  const [label, tone] = APPT[status];
  return <Badge tone={tone} dot>{label}</Badge>;
}

const FU: Record<FollowUpStatus, [string, Tone]> = {
  scheduled: ["Scheduled", "neutral"],
  confirmed: ["Confirmed", "ok"],
  rescheduled: ["Rescheduled", "violet"],
  completed: ["Returned", "info"],
  missed: ["Overdue", "danger"],
  cancelled: ["Cancelled", "neutral"],
};

export function FollowUpBadge({ fu }: { fu: Pick<FollowUp, "status" | "attention"> }) {
  if (fu.attention === "unconfirmed") return <Badge tone="danger" dot>No response</Badge>;
  if (fu.attention === "overdue") return <Badge tone="danger" dot>Overdue — no visit</Badge>;
  const [label, tone] = FU[fu.status];
  return <Badge tone={tone} dot>{label}</Badge>;
}

export const REMINDER_KIND: Record<Reminder["kind"], string> = {
  appointment_1d: "Day-before reminder",
  followup_7d: "7-day reminder",
  followup_3d: "3-day reminder",
};

export function ReminderBadge({ r }: { r: Reminder | null }) {
  if (!r) return <span className="text-xs text-slate">—</span>;
  if (r.response === "confirmed") return <Badge tone="ok">Patient confirmed</Badge>;
  if (r.response === "reschedule_requested") return <Badge tone="violet">Asked to reschedule</Badge>;
  switch (r.status) {
    case "pending":
      return <Badge tone="neutral">Scheduled</Badge>;
    case "processing":
      return <Badge tone="neutral">Sending…</Badge>;
    case "sent":
      if (r.simulated || r.message_status === "simulated") return <Badge tone="violet">Sent (simulated)</Badge>;
      if (r.message_status === "read") return <Badge tone="ok">Read</Badge>;
      if (r.message_status === "delivered") return <Badge tone="ok">Delivered</Badge>;
      if (r.message_status === "failed") return <Badge tone="danger">Failed</Badge>;
      return <Badge tone="info">Sent</Badge>;
    case "failed":
      return <Badge tone="danger">{r.delivery_uncertain ? "Check delivery" : "Failed"}</Badge>;
    case "skipped":
      return <Badge tone="neutral">Not sent</Badge>;
    case "cancelled":
      return <Badge tone="neutral">Cancelled</Badge>;
  }
}

export function MessageStatusLabel({ status }: { status: string }) {
  const map: Record<string, [string, Tone]> = {
    simulated: ["Simulated — not sent via WhatsApp", "violet"],
    sent: ["Sent", "info"],
    delivered: ["Delivered", "ok"],
    read: ["Read", "ok"],
    failed: ["Failed", "danger"],
    received: ["Received", "neutral"],
  };
  const [label, tone] = map[status] || [status, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}
