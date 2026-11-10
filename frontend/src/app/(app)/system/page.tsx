"use client";

import Link from "next/link";
import { Activity, AlertTriangle, Building2, Database, MessageCircle, Server, Webhook } from "lucide-react";
import { Badge } from "@/components/status";
import { Card, CardHeader, ErrorState, Loading, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useData } from "@/lib/hooks";

export interface HospitalRow { id: string; name: string; slug: string; city: string | null; is_active: boolean; is_demo: boolean; created_at: string; users: number; appointments_30d: number; messages_30d: number; failed_reminders: number; whatsapp_mode: string }
interface Status {
  database: string; worker: { healthy: boolean; last_heartbeat: string | null; last_cycle: Record<string, number> | null };
  reminders_pending: number; reminders_failed: number; messages_24h: { sent: number; failed: number; simulated: number; received: number };
  hospitals: { active: number; total: number }; environment: string; demo_mode: boolean; whatsapp_api_version: string;
  webhook: { verify_token_configured: boolean; app_secret_configured: boolean };
}

export default function SystemOverviewPage() {
  const status = useData(() => api.get<Status>("/system/status"), []);
  const hospitals = useData(() => api.get<HospitalRow[]>("/system/hospitals"), []);
  const s = status.data;
  if (!s) return status.error ? <ErrorState text={status.error} onRetry={status.reload} /> : <Loading />;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="System admin" title="Platform overview" subtitle={`Environment: ${s.environment}${s.demo_mode ? " · demo mode enabled" : ""} · WhatsApp Graph API ${s.whatsapp_api_version}`} />
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Database" value={s.database === "ok" ? "Healthy" : "Error"} tone={s.database === "ok" ? "ok" : "danger"} icon={<Database className="size-5" />} />
        <StatCard label="Reminder worker" value={s.worker.healthy ? "Running" : "Not running"} tone={s.worker.healthy ? "ok" : "danger"} icon={<Server className="size-5" />} hint={s.worker.last_heartbeat ? `Last cycle ${fmtDateTime(s.worker.last_heartbeat)}` : "No heartbeat yet"} />
        <StatCard label="Active hospitals" value={s.hospitals.active} icon={<Building2 className="size-5" />} hint={`${s.hospitals.total} total`} />
        <StatCard label="Failed reminders" value={s.reminders_failed} tone={s.reminders_failed ? "danger" : "default"} icon={<AlertTriangle className="size-5" />} hint={`${s.reminders_pending} pending in queue`} />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<MessageCircle className="size-5" />} title="WhatsApp traffic · last 24 hours" />
          <div className="grid grid-cols-4 divide-x divide-silver text-center">
            {Object.entries(s.messages_24h).map(([k, v]) => (
              <div key={k} className="py-5"><div className="tabular text-2xl font-bold">{v}</div><div className="text-xs text-muted capitalize">{k}</div></div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Webhook className="size-5" />} title="Webhook configuration" />
          <ul className="space-y-2 p-5 text-sm">
            <li className="flex justify-between">Verify token (WHATSAPP_VERIFY_TOKEN) {s.webhook.verify_token_configured ? <Badge tone="ok">Configured</Badge> : <Badge tone="warn">Missing</Badge>}</li>
            <li className="flex justify-between">App secret (META_APP_SECRET) {s.webhook.app_secret_configured ? <Badge tone="ok">Configured</Badge> : <Badge tone="warn">Missing</Badge>}</li>
            <li className="flex justify-between">Last worker cycle <span className="text-xs text-muted">{s.worker.last_cycle ? Object.entries(s.worker.last_cycle).map(([k, v]) => `${k} ${v}`).join(" · ") : "—"}</span></li>
          </ul>
        </Card>
      </div>
      <Card>
        <CardHeader icon={<Activity className="size-5" />} title="Hospitals" action={<Link href="/system/hospitals" className="text-[13px] font-semibold text-violet-700 hover:underline">Manage</Link>} />
        {hospitals.data ? (
          <Table>
            <thead><tr><Th>Hospital</Th><Th>Status</Th><Th>WhatsApp</Th><Th>Users</Th><Th>Appointments (30d)</Th><Th>Messages (30d)</Th><Th>Failed</Th></tr></thead>
            <tbody>
              {hospitals.data.map((h) => (
                <tr key={h.id}>
                  <Td><div className="font-semibold">{h.name}{h.is_demo && <Badge tone="violet" className="ml-2">Demo</Badge>}</div><div className="text-xs text-muted">/book/{h.slug}</div></Td>
                  <Td>{h.is_active ? <Badge tone="ok">Active</Badge> : <Badge tone="danger">Suspended</Badge>}</Td>
                  <Td><Badge tone={h.whatsapp_mode === "live" ? "ok" : "neutral"}>{h.whatsapp_mode}</Badge></Td>
                  <Td className="tabular">{h.users}</Td>
                  <Td className="tabular">{h.appointments_30d}</Td>
                  <Td className="tabular">{h.messages_30d}</Td>
                  <Td className="tabular">{h.failed_reminders}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Loading />}
      </Card>
      <p className="text-xs text-muted">Platform administrators manage hospital accounts only — patient records are visible only to each hospital&apos;s own staff.</p>
    </div>
  );
}
