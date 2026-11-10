"use client";

import { useMemo } from "react";
import {
  AlertTriangle, Calendar, CalendarCheck2, Check, CheckCircle2, Clock, MessageCircle, PhoneCall, RotateCcw,
  Send, Stethoscope, User,
} from "lucide-react";
import { Badge } from "@/components/status";
import { Card, CardHeader } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import type { Appointment, Contact, FollowUp, Patient } from "@/lib/types";

interface TimelineEvent {
  id: string;
  date: string;
  time?: string;
  title: string;
  description: string;
  icon: React.ElementType;
  tone: "ok" | "violet" | "warn" | "danger" | "neutral" | "info";
  badge?: string;
}

export function PatientTimeline({
  patient,
  appointments,
  followups,
  contacts,
}: {
  patient: Patient;
  appointments: Appointment[];
  followups: FollowUp[];
  contacts: Contact[];
}) {
  const events = useMemo(() => {
    const list: TimelineEvent[] = [];

    // Appointments
    appointments.forEach((a) => {
      list.push({
        id: `appt-${a.id}`,
        date: a.date,
        time: a.start_time,
        title: `${a.status === "completed" ? "Consultation Completed" : a.status === "confirmed" ? "Appointment Confirmed" : a.status === "reschedule_requested" ? "Reschedule Requested" : "Appointment Booked"} with ${a.doctor.name}`,
        description: `Reference ${a.reference} · ${a.doctor.specialty} · ${a.source === "followup" ? "Follow-up visit" : a.source === "online" ? "Online booking" : "Reception desk"}`,
        icon: a.status === "completed" ? CheckCircle2 : CalendarCheck2,
        tone: a.status === "completed" ? "ok" : a.status === "confirmed" ? "ok" : a.status === "reschedule_requested" ? "violet" : "info",
        badge: a.status.replace("_", " "),
      });

      // Reminder on appointment
      if (a.reminder) {
        const remDate = a.reminder.sent_at ? a.reminder.sent_at.slice(0, 10) : a.reminder.scheduled_for.slice(0, 10);
        const remTime = a.reminder.sent_at ? a.reminder.sent_at.slice(11, 16) : a.reminder.scheduled_for.slice(11, 16);
        list.push({
          id: `rem-${a.reminder.id}`,
          date: remDate,
          time: remTime,
          title: "Day-Before WhatsApp Reminder",
          description: a.reminder.response === "confirmed"
            ? "Patient tapped [Confirm] on WhatsApp"
            : a.reminder.response === "reschedule_requested"
            ? "Patient tapped [Reschedule] on WhatsApp"
            : `Status: ${a.reminder.message_status || a.reminder.status}`,
          icon: MessageCircle,
          tone: a.reminder.response === "confirmed" ? "ok" : a.reminder.response === "reschedule_requested" ? "violet" : "neutral",
          badge: a.reminder.response || a.reminder.status,
        });
      }
    });

    // Follow-ups
    followups.forEach((f) => {
      list.push({
        id: `fu-${f.id}`,
        date: f.due_date,
        title: `Clinical Follow-Up Scheduled with ${f.doctor.name}`,
        description: f.status === "completed"
          ? "Patient visited on time for scheduled follow-up"
          : f.attention === "overdue"
          ? "Target follow-up date passed without return visit"
          : f.attention === "unconfirmed"
          ? "No response received to 7-day and 3-day reminders"
          : `Due on ${fmtDate(f.due_date)}`,
        icon: RotateCcw,
        tone: f.status === "completed" ? "ok" : f.attention ? "danger" : "violet",
        badge: f.attention ? (f.attention === "overdue" ? "Overdue" : "Needs Call") : f.status,
      });

      // Reminders on follow-up (7d & 3d)
      if (f.reminders && f.reminders.length > 0) {
        f.reminders.forEach((r) => {
          const rDate = r.sent_at ? r.sent_at.slice(0, 10) : r.scheduled_for.slice(0, 10);
          const rTime = r.sent_at ? r.sent_at.slice(11, 16) : r.scheduled_for.slice(11, 16);
          const is7d = r.kind === "followup_7d";
          list.push({
            id: `fu-rem-${r.id}`,
            date: rDate,
            time: rTime,
            title: is7d ? "7-Day Follow-Up WhatsApp Reminder" : "3-Day Follow-Up WhatsApp Reminder",
            description: r.response === "confirmed"
              ? "Patient tapped [Confirm] on WhatsApp"
              : r.response === "reschedule_requested"
              ? "Patient tapped [Reschedule] on WhatsApp"
              : `Status: ${r.status}${r.simulated ? " (simulated)" : ""}`,
            icon: Send,
            tone: r.response === "confirmed" ? "ok" : r.status === "failed" ? "danger" : "violet",
            badge: is7d ? "7-Day" : "3-Day",
          });
        });
      }
    });

    // Staff Contacts
    contacts.forEach((c) => {
      list.push({
        id: `contact-${c.id}`,
        date: c.contacted_at.slice(0, 10),
        time: c.contacted_at.slice(11, 19),
        title: `Reception Staff Outreach: ${c.outcome}`,
        description: c.note ? `Staff Note: "${c.note}"` : "Staff logged phone follow-up call",
        icon: PhoneCall,
        tone: c.outcome === "confirmed" ? "ok" : c.outcome === "unreachable" ? "danger" : "warn",
        badge: c.outcome,
      });
    });

    // Sort chronologically (earliest first or latest first)
    list.sort((a, b) => {
      const dtA = `${a.date}T${a.time || "00:00:00"}`;
      const dtB = `${b.date}T${b.time || "00:00:00"}`;
      return dtA.localeCompare(dtB);
    });

    return list;
  }, [appointments, followups, contacts]);

  const toneConfig = {
    ok: { border: "border-emerald-500", bg: "bg-emerald-50 text-emerald-700", ring: "ring-emerald-200" },
    violet: { border: "border-violet-500", bg: "bg-violet-50 text-violet-700", ring: "ring-violet-200" },
    warn: { border: "border-amber-500", bg: "bg-amber-50 text-amber-700", ring: "ring-amber-200" },
    danger: { border: "border-rose-500", bg: "bg-rose-50 text-rose-700", ring: "ring-rose-200" },
    info: { border: "border-blue-500", bg: "bg-blue-50 text-blue-700", ring: "ring-blue-200" },
    neutral: { border: "border-slate-300", bg: "bg-slate-100 text-slate-700", ring: "ring-slate-200" },
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={<Clock className="size-5 text-violet-700" />}
        title="Patient Journey Timeline"
        subtitle="Chronological track of bookings, WhatsApp delivery, replies, and follow-up return visits."
      />

      <div className="p-6">
        {events.length === 0 ? (
          <p className="text-sm text-muted text-center py-8">No journey events recorded yet.</p>
        ) : (
          <div className="relative pl-6 sm:pl-8 space-y-6 before:absolute before:left-2.5 sm:before:left-3.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
            {events.map((ev) => {
              const Icon = ev.icon;
              const cfg = toneConfig[ev.tone];
              return (
                <div key={ev.id} className="relative group">
                  {/* Dot */}
                  <span
                    className={`absolute -left-6 sm:-left-8 top-1 grid size-5 sm:size-7 place-items-center rounded-full bg-white border-2 ${cfg.border} shadow-xs ring-4 ring-white`}
                  >
                    <Icon className="size-2.5 sm:size-3.5 text-ink-2" />
                  </span>

                  {/* Content Box */}
                  <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 transition-all duration-150 hover:bg-white hover:border-slate-300 hover:shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-ink">{ev.title}</span>
                        {ev.badge && (
                          <Badge tone={ev.tone === "danger" ? "danger" : ev.tone === "ok" ? "ok" : ev.tone === "violet" ? "violet" : "neutral"}>
                            {ev.badge}
                          </Badge>
                        )}
                      </div>
                      <span className="tabular text-xs font-semibold text-muted">
                        {fmtDate(ev.date)} {ev.time && `· ${fmtTime(ev.time)}`}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted leading-relaxed">
                      {ev.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

