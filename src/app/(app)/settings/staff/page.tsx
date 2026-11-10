"use client";

import { useState } from "react";
import { KeyRound, Plus, UserCog } from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { Badge } from "@/components/status";
import { Button, Card, ErrorState, Field, Input, Loading, Modal, Notice, Select, Table, Td, Th } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useData } from "@/lib/hooks";

interface StaffUser { id: string; email: string; full_name: string; role: "hospital_admin" | "hospital_staff"; role_name: string; is_active: boolean; last_login_at: string | null }

export default function StaffPage() {
  const toast = useToast();
  const { me } = useAuth();
  const { data, error, reload } = useData(() => api.get<StaffUser[]>("/staff"), []);
  const [adding, setAdding] = useState(false);
  const [pw, setPw] = useState<StaffUser | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(u: StaffUser, body: Record<string, unknown>, ok: string) {
    setBusy(u.id);
    try {
      await api.patch(`/staff/${u.id}`, body);
      toast.success(ok);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!data) return error ? <ErrorState text={error} onRetry={reload} /> : <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted"><b>Admins</b> manage settings, staff, WhatsApp and reports. <b>Staff</b> handle appointments, patients and follow-ups.</p>
        <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add staff member</Button>
      </div>
      <Card>
        <Table>
          <thead><tr><Th>Name</Th><Th>Role</Th><Th>Status</Th><Th>Last sign-in</Th><Th className="text-right">Actions</Th></tr></thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id}>
                <Td><div className="font-semibold">{u.full_name}{u.id === me?.id && <span className="ml-1 text-xs text-muted">(you)</span>}</div><div className="text-xs text-muted">{u.email}</div></Td>
                <Td>
                  <Select value={u.role} disabled={busy === u.id} onChange={(e) => patch(u, { role: e.target.value }, "Role updated")} className="h-8 w-40 text-[13px]" aria-label="Role">
                    <option value="hospital_staff">Hospital Staff</option>
                    <option value="hospital_admin">Hospital Admin</option>
                  </Select>
                </Td>
                <Td>{u.is_active ? <Badge tone="ok">Active</Badge> : <Badge>Deactivated</Badge>}</Td>
                <Td className="text-xs text-muted">{fmtDateTime(u.last_login_at)}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => setPw(u)}>Reset password</Button>
                    {u.id !== me?.id && (
                      <Button size="sm" variant={u.is_active ? "danger" : "secondary"} loading={busy === u.id} onClick={() => patch(u, { is_active: !u.is_active }, u.is_active ? "Account deactivated — signed out everywhere" : "Account reactivated")}>
                        {u.is_active ? "Deactivate" : "Reactivate"}
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <AddStaff open={adding} onClose={() => setAdding(false)} onSaved={reload} />
      <ResetPw user={pw} onClose={() => setPw(null)} />
    </div>
  );
}

function AddStaff({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ full_name: "", email: "", role: "hospital_staff", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/staff", f);
      toast.success(`${f.full_name} can now sign in`);
      setF({ full_name: "", email: "", role: "hospital_staff", password: "" });
      onSaved();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add staff member" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} icon={<UserCog className="size-4" />}>Create account</Button></>}>
      {err && <Notice tone="danger" className="mb-4">{err}</Notice>}
      <div className="space-y-4">
        <Field label="Full name"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Email (used to sign in)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="hospital_staff">Hospital Staff</option><option value="hospital_admin">Hospital Admin</option></Select></Field>
        <Field label="Temporary password" hint="Min 10 characters with letters and numbers. Ask them to change it after first sign-in."><Input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="off" /></Field>
      </div>
    </Modal>
  );
}

function ResetPw({ user, onClose }: { user: StaffUser | null; onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      await api.post(`/staff/${user.id}/password`, { password: pw });
      toast.success(`Password reset for ${user.full_name}. They have been signed out.`);
      setPw("");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={!!user} onClose={onClose} title="Reset password" subtitle={user?.email} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={pw.length < 10} onClick={save}>Set password</Button></>}>
      <Field label="New temporary password" hint="Min 10 characters with letters and numbers"><Input value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" /></Field>
    </Modal>
  );
}
