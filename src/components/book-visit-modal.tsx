"use client";

import { useState } from "react";
import { SlotPicker } from "@/components/slot-picker";
import { useToast } from "@/components/providers";
import { Button, Modal, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateLong, fmtTime } from "@/lib/format";
import type { FollowUp } from "@/lib/types";

/** Staff books the return visit for a follow-up (e.g. after phoning the patient). */
export function BookVisitModal({ fu, today, onClose, onDone }: { fu: FollowUp | null; today: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    if (!fu || !date || !time) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/followups/${fu.id}/book`, { date, start_time: time });
      toast.success(`Visit booked for ${fu.patient.full_name} on ${fmtDate(date)} at ${fmtTime(time)}`);
      setDate(null);
      setTime(null);
      onDone();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={!!fu} onClose={onClose} wide title="Book follow-up visit" subtitle={fu ? `${fu.patient.full_name} · ${fu.doctor.name} · due ${fmtDateLong(fu.due_date)}` : ""}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!date || !time} loading={busy} onClick={save}>Book visit</Button></>}>
      {fu && (
        <>
          {err && <Notice tone="danger" className="mb-3">{err}</Notice>}
          <SlotPicker slotsPath="/appointments/slots" doctorId={fu.doctor.id} today={fu.due_date > today ? today : today} days={35} date={date ?? (fu.due_date >= today ? fu.due_date : null)} time={time} onChange={(d, t) => { setDate(d); setTime(t); }} />
          <p className="mt-3 text-xs text-muted">The visit is booked as confirmed (agreed with the patient). A day-before WhatsApp reminder is scheduled automatically.</p>
        </>
      )}
    </Modal>
  );
}
