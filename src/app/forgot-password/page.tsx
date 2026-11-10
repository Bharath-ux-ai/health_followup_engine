"use client";

import Link from "next/link";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { AuthLayout } from "@/components/auth-layout";
import { Button, Field, Input, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ message: string }>("/auth/forgot-password", { email });
      setDone(r.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new password. The link expires in 30 minutes.">
      {done ? (
        <div className="space-y-6">
          <Notice tone="ok" title={<span className="flex items-center gap-2"><MailCheck className="size-4" /> Check your email</span>}>{done}</Notice>
          <Link href="/login" className="text-sm font-semibold text-violet-700 hover:underline">← Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hospital.in" required autoFocus />
          </Field>
          <Button type="submit" loading={busy} className="w-full" disabled={!email}>Send reset link</Button>
          <p className="text-center text-[13px] text-muted">
            Remembered it? <Link href="/login" className="font-semibold text-violet-700 hover:underline">Sign in</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
