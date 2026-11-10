"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Eye, EyeOff, Lock, Mail, ShieldCheck, Stethoscope, UserCheck } from "lucide-react";
import { useAuth } from "@/components/providers";
import { AuthLayout } from "@/components/auth-layout";
import { Button, Field, Input, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cx } from "@/lib/format";
import type { Me } from "@/lib/types";

const DEMO_ACCOUNTS = [
  {
    role: "Admin",
    title: "Hospital Admin",
    email: "admin@tectha-demo.in",
    password: "TecThaDemo2026",
    icon: ShieldCheck,
    tag: "Full Demo",
    color: "border-violet-300 bg-violet-50/70 text-violet-800 hover:bg-violet-100/70",
    badge: "bg-violet-200 text-violet-900",
  },
  {
    role: "Staff",
    title: "Reception Desk",
    email: "staff@tectha-demo.in",
    password: "TecThaDemo2026",
    icon: Stethoscope,
    tag: "Daily Desk",
    color: "border-emerald-300 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100/70",
    badge: "bg-emerald-200 text-emerald-900",
  },
  {
    role: "Platform",
    title: "System Admin",
    email: "platform@tectha-demo.in",
    password: "TecThaDemo2026",
    icon: UserCheck,
    tag: "Multi-Clinic",
    color: "border-slate-300 bg-slate-100/80 text-slate-800 hover:bg-slate-200/70",
    badge: "bg-slate-300 text-slate-900",
  },
];

export default function LoginPage() {
  const { setMe } = useAuth();
  const [email, setEmail] = useState("admin@tectha-demo.in");
  const [password, setPassword] = useState("TecThaDemo2026");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>("Admin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pickAccount(acc: typeof DEMO_ACCOUNTS[number]) {
    setEmail(acc.email);
    setPassword(acc.password);
    setSelectedRole(acc.role);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<Me>("/auth/login", { email, password });
      setMe(me);
      const next = new URLSearchParams(window.location.search).get("next");
      const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      window.location.assign(safe || (me.role === "system_admin" ? "/system" : "/overview"));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your hospital workspace or choose a demo account below.">
      {/* Demo Quick-Picker */}
      <div className="mb-6 rounded-2xl border border-dashed border-violet-300/80 bg-violet-50/40 p-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[12px] font-bold tracking-tight text-violet-900 uppercase">
            ⚡ Quick Demo Accounts
          </span>
          <span className="text-[11px] text-muted">Click to fill</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {DEMO_ACCOUNTS.map((acc) => {
            const Icon = acc.icon;
            const isSelected = selectedRole === acc.role;
            return (
              <button
                key={acc.role}
                type="button"
                onClick={() => pickAccount(acc)}
                className={cx(
                  "relative flex flex-col items-center justify-center rounded-xl border p-2 text-center transition-all select-none cursor-pointer",
                  isSelected
                    ? "border-violet-600 bg-white ring-2 ring-violet-500/25 shadow-sm"
                    : "border-slate-200 bg-white/70 hover:bg-white hover:border-slate-300",
                )}
              >
                {isSelected && (
                  <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-violet-700 text-white">
                    <Check className="size-2.5" />
                  </span>
                )}
                <Icon className={cx("size-4.5 mb-1", isSelected ? "text-violet-700" : "text-muted")} />
                <span className="text-[12px] font-bold text-ink leading-tight">{acc.role}</span>
                <span className="text-[10px] text-muted">{acc.tag}</span>
              </button>
            );
          })}
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}

        <Field label="Email Address">
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate" />
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSelectedRole("");
              }}
              placeholder="you@hospital.in"
              className="pl-10"
              required
              autoFocus
            />
          </div>
        </Field>

        <Field label="Password">
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate" />
            <Input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setSelectedRole("");
              }}
              className="pl-10 pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-slate hover:text-ink cursor-pointer"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted">Password: <code className="rounded bg-slate-100 px-1 py-0.5 text-ink font-mono text-[11px]">TecThaDemo2026</code></span>
          <Link href="/forgot-password" className="text-[13px] font-semibold text-violet-700 hover:text-violet-800 hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" loading={busy} className="mt-2 w-full h-11 text-[15px]" disabled={!email || !password}>
          Sign in to Workspace
        </Button>
      </form>
    </AuthLayout>
  );
}
