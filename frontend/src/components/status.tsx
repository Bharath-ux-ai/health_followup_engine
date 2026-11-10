import { cx } from "@/lib/format";
import type { AppointmentStatus, FollowUp, FollowUpStatus, Reminder } from "@/lib/types";

type Tone = "neutral" | "violet" | "ok" | "warn" | "danger" | "info" | "dark";
const TONES: Record<Tone, string> = {
  neutral: "bg-silver/70 text-ink-2",
  violet: "bg-violet-50 text-violet-800 ring-1 ring-violet/20",
  ok: "bg-ok-50 text-ok ring-1 ring-ok/20",
  warn: "bg-warn-50 text-warn ring-1 ring-warn/25",
  danger: "bg-danger text-white",
  info: "bg-info-50 text-info ring-1 ring-info/20",
  dark: "bg-ink text-white",
};

export function Badge({ tone = "neutral", children, dot, className }: { tone?: Tone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap", TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
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
