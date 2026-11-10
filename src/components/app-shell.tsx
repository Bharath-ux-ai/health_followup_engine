"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  BarChart3, Building2, CalendarCheck2, CalendarPlus, FlaskConical, LayoutDashboard, LogOut, Menu, MessageCircle,
  RotateCcw, Settings, ShieldCheck, Users, X, KeyRound, MapPin, Search, QrCode,
} from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { Button, Field, Input, Loading, Modal } from "@/components/ui";
import { CommandPalette } from "@/components/command-palette";
import { ClinicQrModal } from "@/components/qr-modal";
import { api, errorMessage } from "@/lib/api";
import { cx, fmtClock } from "@/lib/format";

interface NavItem { href: string; label: string; icon: React.ElementType; perm?: string; demo?: boolean; badge?: string }

const HOSPITAL_NAV: NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, perm: "appointments.view" },
  { href: "/appointments", label: "Appointments", icon: CalendarCheck2, perm: "appointments.view" },
  { href: "/book-appointment", label: "Book Appointment", icon: CalendarPlus, perm: "appointments.manage" },
  { href: "/patients", label: "Patients", icon: Users, perm: "patients.view" },
  { href: "/follow-ups", label: "Follow-ups", icon: RotateCcw, perm: "followups.view" },
  { href: "/messages", label: "WhatsApp Messages", icon: MessageCircle, perm: "messages.view" },
  { href: "/reports", label: "Monthly Reports", icon: BarChart3, perm: "hospital.reports.view" },
  { href: "/settings", label: "Settings", icon: Settings, perm: "hospital.profile.manage" },
  { href: "/demo", label: "Demo Control", icon: FlaskConical, perm: "hospital.demo.control", demo: true, badge: "Live" },
];

const PLATFORM_NAV: NavItem[] = [
  { href: "/system", label: "Platform Overview", icon: ShieldCheck },
  { href: "/system/hospitals", label: "Hospitals", icon: Building2 },
  { href: "/system/settings", label: "Platform Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, loading, can, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (loading || !me) {
    return (
      <div className="grid min-h-dvh place-items-center bg-off">
        <Loading label="Preparing your hospital workspace…" />
      </div>
    );
  }

  const h = me.hospital;
  const nav = me.role === "system_admin" ? PLATFORM_NAV : HOSPITAL_NAV.filter((n) => (!n.perm || can(n.perm)) && (!n.demo || h?.is_demo));
  const isActive = (href: string) => (href === "/system" ? pathname === "/system" : pathname === href || pathname.startsWith(href + "/"));

  const sidebar = (
    <div className="flex h-full flex-col bg-white">
      {/* Brand header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        <Image src="/brand/logo-mark.png" alt="TEC THA" width={40} height={30} className="h-7.5 w-auto" priority />
        <div className="leading-tight">
          <div className="text-[13px] font-extrabold tracking-wider text-ink uppercase">TEC THA</div>
          <div className="text-[11px] font-medium text-muted">Follow-Up Engine</div>
        </div>
      </div>

      {/* Hospital / Clinic card */}
      {h && (
        <div className="mx-4 mb-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 shadow-xs transition-colors hover:bg-slate-100/60">
          <div className="flex items-center justify-between gap-1.5">
            <div className="truncate text-[13px] font-bold text-ink">{h.name}</div>
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <MapPin className="size-3 text-slate" /> {h.city || "Clinic"}
            </span>
            {h.is_demo && (
              <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold tracking-tight text-violet-800">
                DEMO MODE
              </span>
            )}
          </div>
        </div>
      )}

      {/* Quick Search & Actions (Spotlight Ctrl+K trigger) */}
      <div className="px-3 pb-2 space-y-1.5">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex w-full items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs font-semibold text-muted shadow-xs transition-all hover:border-violet-300 hover:bg-white hover:text-ink cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Search className="size-3.5 text-slate" />
            <span>Search or command...</span>
          </span>
          <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate shadow-xs">
            Ctrl K
          </kbd>
        </button>
        {h && (
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition-all hover:bg-violet-50 hover:text-violet-800 hover:border-violet-200 cursor-pointer"
          >
            <QrCode className="size-3.5 text-violet-600" />
            <span>Reception QR Standee</span>
          </button>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-1" aria-label="Main">
        {nav.map((n) => {
          const active = isActive(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className={cx(
                "group relative flex items-center justify-between rounded-xl px-3.5 py-2.5 text-[14px] font-semibold transition-all select-none",
                active
                  ? "bg-violet-50/80 text-violet-800 shadow-xs"
                  : "text-ink-2 hover:bg-slate-50 hover:text-ink",
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                {active && (
                  <span className="absolute left-1 top-2 bottom-2 w-1 rounded-full bg-violet-700" />
                )}
                <n.icon
                  className={cx(
                    "size-4.5 shrink-0 transition-colors",
                    active ? "text-violet-700" : "text-slate group-hover:text-ink-2",
                  )}
                />
                <span className="truncate">{n.label}</span>
              </div>
              {n.badge && (
                <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs">
                  {n.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User profile bottom card */}
      <div className="border-t border-slate-100 p-3 bg-slate-50/40">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200/60 bg-white p-2.5 shadow-xs">
          <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-tr from-violet-700 to-indigo-600 text-xs font-bold text-white shadow-xs">
            {me.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-bold text-ink">{me.full_name}</div>
            <div className="truncate text-[11px] text-muted">{me.role_name}</div>
          </div>
          <button
            onClick={() => setPwOpen(true)}
            title="Change password"
            aria-label="Change password"
            className="rounded-lg p-1.5 text-slate hover:bg-slate-100 hover:text-ink transition-colors cursor-pointer"
          >
            <KeyRound className="size-4" />
          </button>
          <button
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            className="rounded-lg p-1.5 text-slate hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-[256px]">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[256px] border-r border-slate-200/80 bg-white shadow-xs lg:block">
        {sidebar}
      </aside>

      {/* Mobile Drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-xs" onClick={() => setOpen(false)} />
          <aside className="animate-rise absolute inset-y-0 left-0 w-[280px] bg-white shadow-2xl">
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute top-4 right-3.5 rounded-lg p-1.5 text-slate hover:bg-slate-100 hover:text-ink cursor-pointer"
            >
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* Mobile header */}
      <header className="no-print sticky top-0 z-20 flex items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="rounded-lg p-1.5 text-ink hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <Menu className="size-5" />
          </button>
          <Image src="/brand/logo-mark.png" alt="" width={32} height={24} className="h-6 w-auto" />
          <span className="truncate text-sm font-bold text-ink">{h?.name || "TEC THA Platform"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            className="rounded-lg p-1.5 text-slate hover:bg-slate-100 hover:text-ink transition-colors cursor-pointer"
          >
            <Search className="size-5" />
          </button>
          {h?.is_demo && (
            <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800">
              DEMO
            </span>
          )}
        </div>
      </header>

      {/* Interactive Top Demo Ribbon */}
      {h?.demo_clock && (
        <DemoClockRibbon iso={h.demo_clock} tz={h.timezone} canControl={can("hospital.demo.control")} />
      )}

      <main className="mx-auto w-full max-w-[1360px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {children}
      </main>

      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenQr={() => setQrOpen(true)}
      />
      {h && (
        <ClinicQrModal
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          hospitalName={h.name}
          slug={h.slug}
          city={h.city}
        />
      )}
    </div>
  );
}

function DemoClockRibbon({ iso, tz, canControl }: { iso: string; tz: string; canControl: boolean }) {
  const toast = useToast();
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);

  async function quickAdvance(days: number) {
    setBusy(true);
    try {
      await api.post("/demo/clock", { advance_days: days });
      await refresh();
      toast.success(`Demo clock moved +${days} day(s)`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-print sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-violet-200 bg-gradient-to-r from-violet-50 via-purple-50 to-indigo-50 px-4 py-2 text-[13px] text-violet-900 shadow-xs max-lg:top-[53px]">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-600" />
        </span>
        <span className="font-bold tracking-tight">
          Demo Clock: <span className="tabular font-mono text-[13px] font-semibold text-violet-950">{fmtClock(iso, tz)}</span>
        </span>
        <span className="hidden text-xs text-violet-700/80 sm:inline">(Asia/Kolkata)</span>
      </div>

      <div className="flex items-center gap-2">
        {canControl && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => quickAdvance(1)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white/90 px-2 py-0.5 text-xs font-bold text-violet-800 shadow-xs hover:bg-white hover:border-violet-400 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            >
              +1 Day
            </button>
            <button
              onClick={() => quickAdvance(7)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white/90 px-2 py-0.5 text-xs font-bold text-violet-800 shadow-xs hover:bg-white hover:border-violet-400 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            >
              +7 Days
            </button>
            <Link
              href="/demo"
              className="ml-1 inline-flex items-center gap-1 rounded-lg bg-violet-700 px-2.5 py-0.5 text-xs font-bold text-white shadow-xs hover:bg-violet-800 active:scale-95 transition-all"
            >
              <FlaskConical className="size-3" />
              Demo Controls
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: cur, new_password: next });
      toast.success("Password changed successfully.");
      setCur("");
      setNext("");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Change Password" subtitle="Keep your hospital admin account secure.">
      <form onSubmit={save} className="space-y-4">
        <Field label="Current Password">
          <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </Field>
        <Field label="New Password" hint="At least 10 characters with mixed letters and numbers">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={10} required />
        </Field>
        <div className="flex justify-end pt-2">
          <Button type="submit" loading={busy}>Update Password</Button>
        </div>
      </form>
    </Modal>
  );
}
