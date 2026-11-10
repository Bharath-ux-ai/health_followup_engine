"use client";

import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import { useToast } from "@/components/providers";
import { Badge } from "@/components/status";
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { HospitalRow } from "../page";

export default function HospitalsPage() {
  const toast = useToast();
  const { data, error, reload } = useData(() => api.get<HospitalRow[]>("/system/hospitals"), []);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(h: HospitalRow) {
    if (h.is_active && !confirm(`Suspend ${h.name}? Its staff will be signed out and booking will stop.`)) return;
    setBusy(h.id);
    try {
      await api.patch(`/system/hospitals/${h.id}`, { is_active: !h.is_active });
      toast.success(h.is_active ? `${h.name} suspended` : `${h.name} reactivated`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Hospitals" subtitle="Onboard new hospitals and manage their accounts" actions={<Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Onboard hospital</Button>} />
      <Card>
        {error ? <ErrorState text={error} onRetry={reload} /> : !data ? <Loading /> : data.length ? (
          <Table>
            <thead><tr><Th>Hospital</Th><Th>City</Th><Th>Status</Th><Th>Users</Th><Th>Created</Th><Th className="text-right">Action</Th></tr></thead>
            <tbody>
              {data.map((h) => (
                <tr key={h.id}>
                  <Td><div className="font-semibold">{h.name}{h.is_demo && <Badge tone="violet" className="ml-2">Demo</Badge>}</div><a href={`/book/${h.slug}`} target="_blank" rel="noreferrer" className="text-xs text-violet-700 hover:underline">/book/{h.slug}</a></Td>
                  <Td>{h.city || "—"}</Td>
                  <Td>{h.is_active ? <Badge tone="ok">Active</Badge> : <Badge tone="danger">Suspended</Badge>}</Td>
                  <Td className="tabular">{h.users}</Td>
                  <Td className="text-xs text-muted">{fmtDateTime(h.created_at)}</Td>
                  <Td className="text-right"><Button size="sm" variant={h.is_active ? "danger" : "secondary"} loading={busy === h.id} onClick={() => toggle(h)}>{h.is_active ? "Suspend" : "Reactivate"}</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <EmptyState icon={<Building2 className="size-5" />} title="No hospitals yet" action={<Button onClick={() => setOpen(true)}>Onboard the first hospital</Button>} />}
      </Card>
      <Onboard open={open} onClose={() => setOpen(false)} onDone={reload} />
    </div>
  );
}

function Onboard({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const empty = { name: "", slug: "", city: "", phone: "", admin_name: "", admin_email: "", admin_password: "" };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setF((x) => ({ ...x, [k]: v, ...(k === "name" && (!x.slug || x.slug === slugify(x.name)) ? { slug: slugify(v) } : {}) }));
  };
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/system/hospitals", { ...f, city: f.city || null, phone: f.phone || null });
      toast.success(`${f.name} onboarded. ${f.admin_email} can sign in and add doctors.`);
      setF(empty);
      onDone();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Onboard a hospital" subtitle="Creates the hospital, its first admin, default Tamil/English templates and a simulation-mode WhatsApp setup" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Create hospital</Button></>}>
      {err && <Notice tone="danger" className="mb-4">{err}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hospital / clinic name"><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Booking link name" hint={`/book/${f.slug || "…"}`}><Input value={f.slug} onChange={set("slug")} /></Field>
        <Field label="City"><Input value={f.city} onChange={set("city")} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Admin full name"><Input value={f.admin_name} onChange={set("admin_name")} /></Field>
        <Field label="Admin email"><Input type="email" value={f.admin_email} onChange={set("admin_email")} /></Field>
        <Field label="Temporary admin password" hint="Min 10 characters with letters and numbers" className="sm:col-span-2"><Input value={f.admin_password} onChange={set("admin_password")} autoComplete="off" /></Field>
      </div>
    </Modal>
  );
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
