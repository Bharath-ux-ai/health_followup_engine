"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Copy, FlaskConical, Radio, Send, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/providers";
import { Badge, MessageStatusLabel } from "@/components/status";
import { Button, Card, CardHeader, ErrorState, Field, Input, Loading, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cx, fmtDateTime } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Message } from "@/lib/types";

interface Config {
  mode: "simulation" | "live"; phone_number_id: string | null; waba_id: string | null; display_phone_number: string | null; verified_name: string | null;
  access_token_set: boolean; access_token_hint: string | null; app_secret_set: boolean; last_verified_at: string | null; last_error: string | null;
  webhook_url: string; verify_token_configured: boolean; platform_app_secret_configured: boolean; api_version: string; ready_for_live: boolean;
}

export default function WhatsAppSettingsPage() {
  const { data: c, error, reload, setData } = useData(() => api.get<Config>("/whatsapp/config"), []);
  if (!c) return error ? <ErrorState text={error} onRetry={reload} /> : <Loading />;
  return <WhatsAppForm key={`${c.phone_number_id}|${c.waba_id}`} c={c} setData={setData} />;
}

function WhatsAppForm({ c, setData }: { c: Config; setData: (c: Config) => void }) {
  const toast = useToast();
  const [pid, setPid] = useState(c.phone_number_id || "");
  const [waba, setWaba] = useState(c.waba_id || "");
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<Message | null>(null);

  async function run(key: string, fn: () => Promise<Config | void>, ok?: string) {
    setBusy(key);
    try {
      const out = await fn();
      if (out) setData(out);
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const steps = [
    { done: !!c.phone_number_id && c.access_token_set, label: "Phone number ID and permanent access token saved" },
    { done: !!c.last_verified_at, label: "Credentials verified with the Cloud API" },
    { done: c.verify_token_configured && (c.platform_app_secret_configured || c.app_secret_set), label: "Webhook verify token and app secret configured (server)" },
    { done: c.mode === "live", label: "Live mode switched on" },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader icon={<Radio className="size-5" />} title="Sending mode" subtitle="Simulation keeps everything inside the app. Live sends through WhatsApp Business Platform." />
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            {([
              ["simulation", FlaskConical, "Simulation", "Messages appear only in the in-app simulator, labelled “simulated”. Nothing reaches patients."],
              ["live", ShieldCheck, "Live (Cloud API)", "Approved templates are sent to patients who consented. Delivery receipts come back via webhook."],
            ] as const).map(([mode, Icon, title, text]) => (
              <button key={mode} disabled={!!busy} onClick={() => c.mode !== mode && run("mode", () => api.put<Config>("/whatsapp/config", { mode }), `Switched to ${title}`)}
                className={cx("rounded-xl border p-4 text-left transition-colors", c.mode === mode ? "border-violet-700 bg-violet-50 ring-2 ring-violet/15" : "border-silver-2 hover:border-violet")}>
                <div className="flex items-center gap-2 font-bold"><Icon className="size-4 text-violet-700" /> {title} {c.mode === mode && <Badge tone="violet">Current</Badge>}</div>
                <p className="mt-1 text-[13px] text-muted">{text}</p>
              </button>
            ))}
          </div>
          {c.mode === "live" && <p className="px-5 pb-5 text-xs text-muted">Fictional demo patients are always simulated, even in live mode.</p>}
        </Card>

        <Card>
          <CardHeader title="WhatsApp Business account" subtitle={`Meta Graph API ${c.api_version}. Tokens are encrypted at rest and never shown again.`} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Phone number ID" hint="WhatsApp Manager → API Setup"><Input value={pid} onChange={(e) => setPid(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></Field>
            <Field label="WhatsApp Business Account ID" hint="Used to sync template approval"><Input value={waba} onChange={(e) => setWaba(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></Field>
            <Field label="Permanent access token" hint={c.access_token_set ? `Saved (${c.access_token_hint}). Leave blank to keep.` : "System user token with whatsapp_business_messaging"} className="sm:col-span-2">
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder={c.access_token_set ? "••••••••" : "EAAG…"} />
            </Field>
            <Field label="App secret (optional)" hint={c.app_secret_set ? "Saved. Only needed if this hospital uses its own Meta app." : "Only if this hospital uses its own Meta app"} className="sm:col-span-2">
              <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
            </Field>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button loading={busy === "save"} onClick={() => run("save", async () => { const out = await api.put<Config>("/whatsapp/config", { phone_number_id: pid, waba_id: waba, ...(token ? { access_token: token } : {}), ...(secret ? { app_secret: secret } : {}) }); setToken(""); setSecret(""); return out; }, "Saved")}>Save credentials</Button>
              <Button variant="secondary" loading={busy === "verify"} disabled={!c.access_token_set} onClick={() => run("verify", () => api.post<Config>("/whatsapp/config/verify"), "Credentials verified")}>Verify with WhatsApp</Button>
            </div>
            {c.verified_name && <Notice tone="ok" className="sm:col-span-2">Connected: <b>{c.verified_name}</b> · {c.display_phone_number} · verified {fmtDateTime(c.last_verified_at)}</Notice>}
            {c.last_error && <Notice tone="danger" className="sm:col-span-2">{c.last_error}</Notice>}
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Send className="size-5" />} title="Send a test message" subtitle="Sends Meta's “hello_world” template to a number you own (live mode only)" />
          <div className="flex flex-wrap items-end gap-3 p-5">
            <Field label="Your WhatsApp number" className="w-64"><Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="98765 43210" /></Field>
            <Button variant="secondary" disabled={c.mode !== "live" || !testPhone} loading={busy === "test"} onClick={() => run("test", async () => { setTest(await api.post<Message>("/whatsapp/test-message", { phone: testPhone })); })}>Send test</Button>
            {test && <div className="flex items-center gap-2 text-sm"><MessageStatusLabel status={test.status} />{test.error_message && <span className="text-xs text-danger">{test.error_message}</span>}</div>}
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Go-live checklist" />
          <ul className="space-y-3 p-5 text-sm">
            {steps.map((s) => (
              <li key={s.label} className="flex items-start gap-2.5">{s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <Circle className="mt-0.5 size-4 shrink-0 text-slate" />}<span className={s.done ? "" : "text-muted"}>{s.label}</span></li>
            ))}
            <li className="flex items-start gap-2.5"><Circle className="mt-0.5 size-4 shrink-0 text-slate" /><span className="text-muted">Reminder templates approved by Meta (see Message templates)</span></li>
          </ul>
        </Card>
        <Card>
          <CardHeader title="Webhook" subtitle="Meta App → WhatsApp → Configuration" />
          <div className="space-y-3 p-5 text-sm">
            <div>
              <div className="text-xs font-semibold text-muted">Callback URL</div>
              <div className="mt-1 flex items-center gap-2"><code className="flex-1 truncate rounded bg-off px-2 py-1 text-[12px]">{c.webhook_url}</code>
                <button onClick={() => { navigator.clipboard?.writeText(c.webhook_url); toast.success("Copied"); }} aria-label="Copy URL" className="text-slate hover:text-ink"><Copy className="size-4" /></button></div>
            </div>
            <p className="text-xs text-muted">Verify token: the server&apos;s <code>WHATSAPP_VERIFY_TOKEN</code> ({c.verify_token_configured ? "configured" : "not set"}). Subscribe to the <b>messages</b> field. Every webhook is checked against the app secret signature ({c.platform_app_secret_configured || c.app_secret_set ? "configured" : "not set"}).</p>
            <p className="text-xs text-muted">The URL must be public HTTPS — Meta cannot reach localhost.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
