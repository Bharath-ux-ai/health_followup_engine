"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, Building2, CalendarCheck2, CalendarPlus, Clock3, FlaskConical, LayoutDashboard, LogOut, Menu, MessageCircle,
  RotateCcw, Settings, ShieldCheck, Users, X, KeyRound,
} from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { Button, Field, Input, Loading, Modal } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cx, fmtClock } from "@/lib/format";

interface NavItem { href: string; label: string; icon: React.ElementType; perm?: string; demo?: boolean }

const HOSPITAL_NAV: NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, perm: "appointments.view" },
  { href: "/appointments", label: "Appointments", icon: CalendarCheck2, perm: "appointments.view" },
  { href: "/book-appointment", label: "Book Appointment", icon: CalendarPlus, perm: "appointments.manage" },
  { href: "/patients", label: "Patients", icon: Users, perm: "patients.view" },
  { href: "/follow-ups", label: "Follow-ups", icon: RotateCcw, perm: "followups.view" },
  { href: "/messages", label: "WhatsApp Messages", icon: MessageCircle, perm: "messages.view" },
  { href: "/reports", label: "Monthly Reports", icon: BarChart3, perm: "hospital.reports.view" },
  { href: "/settings", label: "Settings", icon: Settings, perm: "hospital.profile.manage" },
  { href: "/demo", label: "Demo Control", icon: FlaskConical, perm: "hospital.demo.control", demo: true },
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

  if (loading || !me) return <div className="grid min-h-dvh place-items-center"><Loading label="Loading your workspace…" /></div>;

  const h = me.hospital;
  const nav = me.role === "system_admin" ? PLATFORM_NAV : HOSPITAL_NAV.filter((n) => (!n.perm || can(n.perm)) && (!n.demo || h?.is_demo));
  const isActive = (href: string) => (href === "/system" ? pathname === "/system" : pathname === href || pathname.startsWith(href + "/"));

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <Image src="/brand/logo-mark.png" alt="TEC THA" width={44} height={32} className="h-8 w-auto" priority />
        <div className="leading-tight">
          <div className="text-[13px] font-extrabold tracking-wide text-ink">TEC THA</div>
          <div className="text-[11px] font-semibold text-muted">Follow-Up Engine</div>
        </div>
      </div>
      {h && (
        <div className="mx-4 mb-3 rounded-xl border border-silver bg-off px-3 py-2.5">
          <div className="truncate text-[13px] font-bold text-ink">{h.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
            {h.city}
            {h.is_demo && <span className="rounded bg-violet-100 px-1.5 py-px font-bold text-violet-800">DEMO</span>}
          </div>
        </div>
      )}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => setOpen(false)}
            className={cx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-semibold transition-colors",
              isActive(n.href) ? "bg-violet-50 text-violet-800" : "text-ink-2 hover:bg-off hover:text-ink",
            )}
          >
            <n.icon className={cx("size-[18px]", isActive(n.href) ? "text-violet-700" : "text-slate")} />
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-silver p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-white">
            {me.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold">{me.full_name}</div>
            <div className="truncate text-[11px] text-muted">{me.role_name}</div>
          </div>
          <button onClick={() => setPwOpen(true)} title="Change password" aria-label="Change password" className="rounded-md p-1.5 text-slate hover:bg-off hover:text-ink">
            <KeyRound className="size-4" />
          </button>
          <button onClick={logout} title="Sign out" aria-label="Sign out" className="rounded-md p-1.5 text-slate hover:bg-off hover:text-ink">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-silver bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="animate-rise absolute inset-y-0 left-0 w-[272px] bg-white shadow-xl">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute top-4 right-3 rounded-md p-1 text-slate">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-silver bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-md p-1.5 text-ink">
          <Menu className="size-5" />
        </button>
        <Image src="/brand/logo-mark.png" alt="" width={36} height={26} className="h-6 w-auto" />
        <span className="truncate text-sm font-bold">{h?.name || "TEC THA Platform"}</span>
      </header>
      {h?.demo_clock && <DemoClockRibbon iso={h.demo_clock} tz={h.timezone} canControl={can("hospital.demo.control")} />}
      <main className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function DemoClockRibbon({ iso, tz, canControl }: { iso: string; tz: string; canControl: boolean }) {
  return (
    <div className="no-print sticky top-0 z-20 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-violet/20 bg-violet-50 px-4 py-2 text-[13px] text-violet-800 max-lg:top-[57px]">
      <Clock3 className="size-4" />
      <span>
        <b>Demo time:</b> {fmtClock(iso, tz)} <span className="text-violet-800/70">(simulated clock — real records unaffected)</span>
      </span>
      {canControl && (
        <Link href="/demo" className="font-semibold underline underline-offset-2">
          Demo controls
        </Link>
      )}
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
      toast.success("Password changed. Other devices have been signed out.");
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
    <Modal open={open} onClose={onClose} title="Change password">
      <form onSubmit={save} className="space-y-4">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 10 characters with letters and numbers">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={10} required />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>Update password</Button>
        </div>
      </form>
    </Modal>
  );
}
