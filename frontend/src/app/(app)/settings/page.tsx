"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { Button, Card, CardHeader, Checkbox, ErrorState, Field, Input, Loading, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useData } from "@/lib/hooks";
import type { Hospital } from "@/lib/types";

export default function HospitalSettingsPage() {
  const { data, error, reload } = useData(() => api.get<Hospital>("/hospital"), []);
  if (!data) return error ? <ErrorState text={error} onRetry={reload} /> : <Loading />;
  return <HospitalForm key={JSON.stringify(data)} data={data} reload={reload} />;
}

function HospitalForm({ data, reload }: { data: Hospital; reload: () => void }) {
  const toast = useToast();
  const { refresh } = useAuth();
  const [f, setF] = useState<Partial<Hospital>>(data);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Hospital) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const url = typeof window !== "undefined" ? `${window.location.origin}/book/${data.slug}` : "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch("/hospital", {
        name: f.name, phone: f.phone || null, email: f.email || null, address: f.address || null, city: f.city || null,
        timezone: f.timezone, reminder_send_time: f.reminder_send_time, default_language: f.default_language,
        slot_minutes: Number(f.slot_minutes), booking_window_days: Number(f.booking_window_days), booking_enabled: f.booking_enabled,
      });
      toast.success("Hospital settings saved");
      reload();
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Hospital profile" subtitle="Shown on the booking page and in WhatsApp messages" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Hospital name" className="sm:col-span-2"><Input value={f.name || ""} onChange={set("name")} required /></Field>
          <Field label="Phone"><Input value={f.phone || ""} onChange={set("phone")} /></Field>
          <Field label="Email"><Input type="email" value={f.email || ""} onChange={set("email")} /></Field>
          <Field label="Address" className="sm:col-span-2"><Input value={f.address || ""} onChange={set("address")} /></Field>
          <Field label="City"><Input value={f.city || ""} onChange={set("city")} /></Field>
          <Field label="Timezone"><Input value={f.timezone || ""} onChange={set("timezone")} /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Booking & reminders" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Reminder send time" hint="Day-before, 7-day and 3-day reminders go out at this local time"><Input type="time" value={f.reminder_send_time || ""} onChange={set("reminder_send_time")} /></Field>
          <Field label="Default message language">
            <Select value={f.default_language} onChange={set("default_language")}><option value="en">English</option><option value="ta">Tamil</option></Select>
          </Field>
          <Field label="Default slot length (minutes)"><Input type="number" min={5} max={120} value={f.slot_minutes ?? ""} onChange={set("slot_minutes")} /></Field>
          <Field label="Online booking window (days)"><Input type="number" min={1} max={180} value={f.booking_window_days ?? ""} onChange={set("booking_window_days")} /></Field>
          <div className="sm:col-span-2"><Checkbox checked={!!f.booking_enabled} onChange={(v) => setF({ ...f, booking_enabled: v })} label="Accept online bookings" description="When off, the booking link shows your phone number instead." /></div>
          <div className="sm:col-span-2 rounded-xl bg-off p-3">
            <div className="text-xs font-semibold text-muted">Shareable booking link</div>
            <div className="mt-1 flex items-center gap-2"><code className="flex-1 truncate text-[13px]">{url}</code>
              <Button type="button" size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => { navigator.clipboard?.writeText(url); toast.success("Copied"); }}>Copy</Button></div>
          </div>
        </div>
      </Card>
      <div className="lg:col-span-2"><Button type="submit" loading={busy}>Save changes</Button></div>
    </form>
  );
}
