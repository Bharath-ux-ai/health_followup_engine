"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { Button, Field, Input, Loading, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

function ResetForm() {
  const token = useSearchParams().get("token") || "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setError("The two passwords do not match");
    setState("busy");
    setError(null);
    try {
      await api.post("/auth/reset-password", { token, password: pw });
      setState("done");
    } catch (err) {
      setError(errorMessage(err));
      setState("idle");
    }
  }

  if (!token) return <Notice tone="danger">This reset link is incomplete. Please request a new one.</Notice>;
  if (state === "done")
    return (
      <div className="space-y-6">
        <Notice tone="ok" title="Password updated">You can now sign in with your new password.</Notice>
        <Link href="/login"><Button className="w-full">Go to sign in</Button></Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label="New password" hint="At least 10 characters, with letters and numbers">
        <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={10} required autoFocus />
      </Field>
      <Field label="Confirm new password">
        <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
      </Field>
      <Button type="submit" loading={state === "busy"} className="w-full" disabled={!pw || !pw2}>Set new password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout title="Choose a new password">
      <Suspense fallback={<Loading />}>
        <ResetForm />
      </Suspense>
    </AuthLayout>
  );
}
