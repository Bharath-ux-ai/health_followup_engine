"use client";

import { useState } from "react";
import { Plus, Stethoscope, Trash2 } from "lucide-react";
import { useToast } from "@/components/providers";
import { Badge } from "@/components/status";
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtTime, WEEKDAYS } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Availability, Doctor } from "@/lib/types";

export default function DoctorsPage() {
  const { data, error, reload } = useData(() => api.get<Doctor[]>("/doctors", { include_inactive: true }), []);
  const [editing, setEditing] = useState<Doctor | "new" | null>(null);
  if (!data) return error ? <ErrorState text={error} onRetry={reload} /> : <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Weekly consultation hours define the slots patients can book.</p>
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Add doctor</Button>
      </div>
      {data.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((d) => (
            <Card key={d.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-full bg-violet-50 text-violet-700"><Stethoscope className="size-5" /></span>
                  <div><div className="font-bold">{d.name}</div><div className="text-[13px] text-muted">{d.specialty}</div></div>
                </div>
                {!d.is_active && <Badge>Inactive</Badge>}
              </div>
              <ul className="mt-4 space-y-1 text-[13px]">
                {groupByDay(d.availability || []).map(([day, ws]) => (
                  <li key={day} className="flex justify-between gap-2"><span className="text-muted">{WEEKDAYS[day].slice(0, 3)}</span><span className="tabular">{ws.map((w) => `${fmtTime(w.start_time)}–${fmtTime(w.end_time)}`).join(", ")}</span></li>
                ))}
                {!d.availability?.length && <li className="text-warn">No consultation hours — not bookable</li>}
              </ul>
              <Button size="sm" variant="secondary" className="mt-4" onClick={() => setEditing(d)}>Edit schedule</Button>
            </Card>
          ))}
        </div>
      ) : (
        <Card><EmptyState icon={<Stethoscope className="size-5" />} title="No doctors yet" text="Add at least one doctor with consultation hours to open online booking." action={<Button onClick={() => setEditing("new")}>Add doctor</Button>} /></Card>
      )}
      {editing && <DoctorEditor doctor={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}

function groupByDay(ws: Availability[]): [number, Availability[]][] {
  const m = new Map<number, Availability[]>();
  ws.forEach((w) => m.set(w.weekday, [...(m.get(w.weekday) || []), w]));
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

function DoctorEditor({ doctor, onClose, onSaved }: { doctor: Doctor | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(doctor?.name || "");
  const [specialty, setSpecialty] = useState(doctor?.specialty || "");
  const [active, setActive] = useState(doctor?.is_active ?? true);
  const [rows, setRows] = useState<Availability[]>(doctor?.availability?.length ? doctor.availability : [0, 1, 2, 3, 4, 5].map((d) => ({ weekday: d, start_time: "09:00", end_time: "13:00", slot_minutes: null })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upd = (i: number, k: keyof Availability, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: k === "weekday" ? Number(v) : k === "slot_minutes" ? (v ? Number(v) : null) : v } : r)));

  async function save() {
    setBusy(true);
    setErr(null);
    const body = { name, specialty: specialty || null, is_active: active, availability: rows };
    try {
      if (doctor) await api.put(`/doctors/${doctor.id}`, body);
      else await api.post("/doctors", body);
      toast.success("Doctor saved");
      onSaved();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!doctor || !confirm(`Remove ${doctor.name}? Existing appointments are kept.`)) return;
    try {
      await api.del(`/doctors/${doctor.id}`);
      toast.success("Doctor removed");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Modal open onClose={onClose} wide title={doctor ? `Edit ${doctor.name}` : "Add doctor"}
      footer={<>{doctor && <Button variant="danger" className="mr-auto" icon={<Trash2 className="size-4" />} onClick={remove}>Remove</Button>}<Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} disabled={name.trim().length < 2}>Save</Button></>}>
      {err && <Notice tone="danger" className="mb-4">{err}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. …" /></Field>
        <Field label="Specialty"><Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="General Physician" /></Field>
        <div className="sm:col-span-2"><Checkbox checked={active} onChange={setActive} label="Accepting appointments" /></div>
      </div>
      <h3 className="mt-6 mb-2 text-sm font-bold">Weekly consultation hours</h3>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_90px_36px] items-center gap-2">
            <Select value={r.weekday} onChange={(e) => upd(i, "weekday", e.target.value)} aria-label="Day">{WEEKDAYS.map((d, j) => <option key={d} value={j}>{d}</option>)}</Select>
            <Input type="time" value={r.start_time} onChange={(e) => upd(i, "start_time", e.target.value)} aria-label="From" />
            <Input type="time" value={r.end_time} onChange={(e) => upd(i, "end_time", e.target.value)} aria-label="To" />
            <Input type="number" min={5} max={120} placeholder="Slot" value={r.slot_minutes ?? ""} onChange={(e) => upd(i, "slot_minutes", e.target.value)} aria-label="Slot minutes" title="Slot minutes (blank = hospital default)" />
            <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="grid size-9 place-items-center rounded-lg text-slate hover:bg-danger-50 hover:text-danger" aria-label="Remove window"><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="secondary" className="mt-3" icon={<Plus className="size-3.5" />} onClick={() => setRows([...rows, { weekday: 0, start_time: "17:00", end_time: "19:00", slot_minutes: null }])}>Add window</Button>
      <p className="mt-2 text-xs text-muted">Slot length blank = hospital default. Add two windows on the same day for morning and evening sessions.</p>
    </Modal>
  );
}
