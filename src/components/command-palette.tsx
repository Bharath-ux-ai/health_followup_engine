"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock, ArrowRight, BarChart3, CalendarCheck2, CalendarPlus, Check, Copy, FastForward,
  FlaskConical, LayoutDashboard, MessageCircle, QrCode, RotateCcw, Search, Send, Settings, User, Users,
} from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import { cx } from "@/lib/format";

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  section: "Actions" | "Navigation" | "Demo Patients";
  keywords?: string[];
  action: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onOpenQr,
}: {
  open: boolean;
  onClose: () => void;
  onOpenQr: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { me, refresh, can } = useAuth();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const h = me?.hospital;

  // Build command items
  const items: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [
      // Actions
      {
        id: "qr-standee",
        title: "Show Clinic QR Code Standee",
        subtitle: "Printable QR standee for reception counter",
        icon: QrCode,
        section: "Actions",
        keywords: ["qr", "print", "standee", "reception", "scan"],
        action: () => {
          onClose();
          onOpenQr();
        },
      },
      {
        id: "copy-booking-link",
        title: "Copy Public Booking Link",
        subtitle: h ? `/book/${h.slug}` : "/book/tectha-clinic",
        icon: Copy,
        section: "Actions",
        keywords: ["link", "share", "url", "patient", "booking"],
        action: () => {
          onClose();
          const url = typeof window !== "undefined" && h ? `${window.location.origin}/book/${h.slug}` : "";
          if (url && navigator.clipboard) {
            navigator.clipboard.writeText(url);
            toast.success("Booking link copied to clipboard");
          }
        },
      },
    ];

    if (can("hospital.demo.control") && h?.is_demo) {
      list.push(
        {
          id: "advance-1d",
          title: "Advance Demo Clock +1 Day",
          subtitle: "Simulates moving ahead 24 hours to trigger reminders",
          icon: FastForward,
          section: "Actions",
          keywords: ["clock", "day", "tomorrow", "time", "advance"],
          action: async () => {
            onClose();
            try {
              await api.post("/demo/clock", { advance_days: 1 });
              await refresh();
              toast.success("Demo clock advanced +1 Day");
            } catch (e) {
              toast.error(errorMessage(e));
            }
          },
        },
        {
          id: "advance-7d",
          title: "Advance Demo Clock +7 Days",
          subtitle: "Fast-forward 1 week to see follow-up return status",
          icon: FastForward,
          section: "Actions",
          keywords: ["week", "7", "followup", "clock"],
          action: async () => {
            onClose();
            try {
              await api.post("/demo/clock", { advance_days: 7 });
              await refresh();
              toast.success("Demo clock advanced +7 Days");
            } catch (e) {
              toast.error(errorMessage(e));
            }
          },
        },
        {
          id: "trigger-reminders",
          title: "Trigger Due WhatsApp Reminders",
          subtitle: "Dispatches all pending day-before, 7-day and 3-day messages",
          icon: Send,
          section: "Actions",
          keywords: ["send", "whatsapp", "reminder", "dispatch", "run"],
          action: async () => {
            onClose();
            try {
              const r = await api.post<{ totals: { sent: number; simulated: number } }>("/demo/run-reminders");
              toast.success(`Processed reminders: ${r.totals.simulated + r.totals.sent} dispatched`);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          },
        },
      );
    }

    // Navigation
    list.push(
      {
        id: "nav-overview",
        title: "Overview Dashboard",
        subtitle: "Today's metrics, urgent call list and clinic summary",
        icon: LayoutDashboard,
        section: "Navigation",
        keywords: ["home", "dashboard", "today", "metrics"],
        action: () => {
          onClose();
          router.push("/overview");
        },
      },
      {
        id: "nav-appointments",
        title: "Appointments List",
        subtitle: "Manage patient visits, check-ins, and statuses",
        icon: CalendarCheck2,
        section: "Navigation",
        keywords: ["appointments", "schedule", "visited", "slots"],
        action: () => {
          onClose();
          router.push("/appointments");
        },
      },
      {
        id: "nav-book",
        title: "Book Reception Appointment",
        subtitle: "Walk-in patient booking desk",
        icon: CalendarPlus,
        section: "Navigation",
        keywords: ["new", "book", "walk-in", "reception"],
        action: () => {
          onClose();
          router.push("/book-appointment");
        },
      },
      {
        id: "nav-followups",
        title: "Follow-Up Patients & Overdue List",
        subtitle: "Patients awaiting return, unconfirmed, or needing a call",
        icon: RotateCcw,
        section: "Navigation",
        keywords: ["followup", "overdue", "missed", "call", "red"],
        action: () => {
          onClose();
          router.push("/follow-ups?view=attention");
        },
      },
      {
        id: "nav-messages",
        title: "WhatsApp Simulator & Conversations",
        subtitle: "Interactive WhatsApp patient chat and delivery logs",
        icon: MessageCircle,
        section: "Navigation",
        keywords: ["chat", "whatsapp", "simulator", "messages", "templates"],
        action: () => {
          onClose();
          router.push("/messages");
        },
      },
      {
        id: "nav-reports",
        title: "Monthly Reports & Retention",
        subtitle: "Brought back patients, attendance trends, and CSV exports",
        icon: BarChart3,
        section: "Navigation",
        keywords: ["reports", "stats", "retention", "monthly", "excel", "csv"],
        action: () => {
          onClose();
          router.push("/reports");
        },
      },
    );

    if (h?.is_demo) {
      list.push({
        id: "nav-demo",
        title: "Demo Control Cockpit",
        subtitle: "Simulated clock, Mr. Ravi stepper, and data reset",
        icon: FlaskConical,
        section: "Navigation",
        keywords: ["demo", "clock", "ravi", "reset", "simulation"],
        action: () => {
          onClose();
          router.push("/demo");
        },
      });
    }

    // Demo Patients
    list.push(
      {
        id: "patient-ravi",
        title: "Mr. Ravi (Guided Scenario Patient)",
        subtitle: "Primary guided journey: Dr. Arun Kumar · 98765 00001",
        icon: User,
        section: "Demo Patients",
        keywords: ["ravi", "patient", "demo"],
        action: () => {
          onClose();
          router.push("/demo");
        },
      },
      {
        id: "patient-list",
        title: "Browse All Hospital Patients",
        subtitle: "Patient contact logs, appointment histories and consent",
        icon: Users,
        section: "Demo Patients",
        keywords: ["patients", "directory", "search"],
        action: () => {
          onClose();
          router.push("/patients");
        },
      },
    );

    return list;
  }, [h, can, onClose, onOpenQr, refresh, router, toast]);

  // Filter items based on query
  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle?.toLowerCase().includes(q) ||
        item.keywords?.some((k) => k.toLowerCase().includes(q)),
    );
  }, [items, query]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((prev) => (prev + 1 < filtered.length ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((prev) => (prev - 1 >= 0 ? prev - 1 : filtered.length - 1));
      } else if (e.key === "Enter" && filtered[activeIdx]) {
        e.preventDefault();
        filtered[activeIdx].action();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, filtered, activeIdx, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 sm:p-6 sm:pt-24">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Palette Box */}
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-2xl animate-rise">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
          <Search className="size-5 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="Type a command, search pages or patients... (e.g. 'clock', 'ravi', 'qr')"
            className="w-full text-base font-medium text-ink placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-muted">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[360px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted">
              No matching commands or pages found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((item, idx) => {
                const Icon = item.icon;
                const isSelected = idx === activeIdx;
                return (
                  <button
                    key={item.id}
                    onClick={() => item.action()}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={cx(
                      "flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-left transition-all cursor-pointer select-none",
                      isSelected
                        ? "bg-violet-50/90 text-violet-950 shadow-xs ring-1 ring-violet-200/80"
                        : "text-ink hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cx(
                          "grid size-9 shrink-0 place-items-center rounded-xl transition-colors",
                          isSelected
                            ? "bg-violet-700 text-white shadow-xs"
                            : "bg-slate-100 text-slate-600",
                        )}
                      >
                        <Icon className="size-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold tracking-tight">
                          {item.title}
                        </div>
                        {item.subtitle && (
                          <div className="truncate text-xs text-muted">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 uppercase">
                        {item.section}
                      </span>
                      {isSelected && (
                        <ArrowRight className="size-4 text-violet-700 shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom Shortcut Bar */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[11px] text-muted">
          <div className="flex items-center gap-3">
            <span>
              Navigate with <kbd className="rounded bg-white px-1 py-0.5 border border-slate-200 shadow-2xs font-mono font-bold">↑</kbd> <kbd className="rounded bg-white px-1 py-0.5 border border-slate-200 shadow-2xs font-mono font-bold">↓</kbd>
            </span>
            <span>
              Select with <kbd className="rounded bg-white px-1.5 py-0.5 border border-slate-200 shadow-2xs font-mono font-bold">↵ Enter</kbd>
            </span>
          </div>
          <span className="hidden sm:inline font-semibold text-violet-800">
            TEC THA Spotlight
          </span>
        </div>
      </div>
    </div>
  );
}

