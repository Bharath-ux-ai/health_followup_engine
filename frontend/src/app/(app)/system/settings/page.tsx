"use client";

import { useState } from "react";
import { useToast } from "@/components/providers";
import { Button, Card, CardHeader, ErrorState, Field, Input, Loading, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useData } from "@/lib/hooks";

interface Platform { support_email?: string; support_phone?: string; default_reminder_time?: string; default_timezone?: string }

export default function PlatformSettingsPage() {
  const { data, error, reload } = useData(() => api.get<Platform>("/system/settings"), []);
  if (!data) return error ? <ErrorState text={error} onRetry={reload} /> : <Loading />;
  return <PlatformForm initial={data} />;
}

function PlatformForm({ initial }: { initial: Platform }) {
  const toast = useToast();
  const [f, setF] = useState<Platform>(initial);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setF(await api.put<Platform>("/system/settings", { support_email: f.support_email || null, support_phone: f.support_phone || null, default_reminder_time: f.default_reminder_time || null, default_timezone: f.default_timezone || null }));
      toast.success("Platform settings saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <PageHeader title="Platform settings" subtitle="Defaults applied when onboarding new hospitals" />
      <form onSubmit={save}>
        <Card className="max-w-2xl">
          <CardHeader title="Defaults & support" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Default reminder send time"><Input type="time" value={f.default_reminder_time || ""} onChange={(e) => setF({ ...f, default_reminder_time: e.target.value })} /></Field>
            <Field label="Default timezone"><Input value={f.default_timezone || ""} onChange={(e) => setF({ ...f, default_timezone: e.target.value })} placeholder="Asia/Kolkata" /></Field>
            <Field label="Support email"><Input type="email" value={f.support_email || ""} onChange={(e) => setF({ ...f, support_email: e.target.value })} /></Field>
            <Field label="Support phone"><Input value={f.support_phone || ""} onChange={(e) => setF({ ...f, support_phone: e.target.value })} /></Field>
            <p className="text-xs text-muted sm:col-span-2">Secrets (database, encryption key, Meta app secret, webhook verify token) live in server environment variables — never in the database or this screen.</p>
            <div><Button type="submit" loading={busy}>Save</Button></div>
          </div>
        </Card>
      </form>
    </div>
  );
}
