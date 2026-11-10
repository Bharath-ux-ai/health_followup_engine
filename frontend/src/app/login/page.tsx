"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/providers";
import { AuthLayout } from "@/components/auth-layout";
import { Button, Field, Input, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Me } from "@/lib/types";

export default function LoginPage() {
  const { setMe } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <AuthLayout title="Sign in" subtitle="Use the account your hospital administrator created for you.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Email">
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hospital.in" required autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-[13px] font-semibold text-violet-700 hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" loading={busy} className="w-full" disabled={!email || !password}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}
