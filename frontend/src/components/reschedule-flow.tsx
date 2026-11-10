"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { SlotPicker } from "@/components/slot-picker";
import { Button, ErrorState, Loading, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateLong, fmtTime } from "@/lib/format";
import { useData } from "@/lib/hooks";

interface ActionInfo {
  kind: "appt" | "fu";
  hospital: { name: string; phone: string | null; slug: string };
  doctor: { id: string; name: string; specialty: string | null; weekdays: number[] };
  current: { reference: string; date: string; start_time: string } | null;
  followup_due: string | null;
  today: string;
  booking_window_days: number;
}
export interface RescheduleResult { reference: string; date: string; start_time: string; doctor: string }

/** Patient-side "choose a new time" flow behind the signed link sent on WhatsApp. */
export function RescheduleFlow({ token, compact, onDone }: { token: string; compact?: boolean; onDone?: (r: RescheduleResult) => void }) {
  const { data: info, error, loading, reload } = useData(() => api.get<ActionInfo>(`/public/actions/${token}`), [token]);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<RescheduleResult | null>(null);
  const [k, setK] = useState(0);

  async function confirm() {
    if (!date || !time) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<RescheduleResult>(`/public/actions/${token}/reschedule`, { date, start_time: time });
      setDone(r);
      onDone?.(r);
    } catch (e) {
      setErr(errorMessage(e));
      setTime(null);
      setK((x) => x + 1);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !info) return <Loading />;
  if (error || !info) return <ErrorState text={error || "This link is no longer active."} onRetry={reload} />;
  if (done)
    return (
      <div className="animate-rise text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-ok text-white"><Check className="size-5" /></div>
        <h3 className="mt-3 text-lg font-bold">You&apos;re booked</h3>
        <p className="mt-1 text-sm text-muted">{done.doctor} · {fmtDateLong(done.date)} at {fmtTime(done.start_time)}</p>
        <p className="mt-2 font-mono text-sm font-bold tracking-wider text-violet-800">{done.reference}</p>
      </div>
    );

  return (
    <div>
      {!compact && (
        <div className="mb-4 rounded-xl bg-off px-4 py-3 text-sm">
          <div className="font-bold">{info.doctor.name} <span className="font-normal text-muted">· {info.doctor.specialty}</span></div>
          {info.current ? (
            <div className="text-muted">Current: {fmtDateLong(info.current.date)} at {fmtTime(info.current.start_time)} · {info.current.reference}</div>
          ) : (
            <div className="text-muted">Follow-up visit due {fmtDateLong(info.followup_due)}</div>
          )}
        </div>
      )}
      {err && <Notice tone="danger" className="mb-3">{err}</Notice>}
      <SlotPicker key={k} slotsPath={`/public/actions/${token}/slots`} today={info.today} days={Math.min(info.booking_window_days, 42)} weekdays={info.doctor.weekdays} date={date} time={time} onChange={(d, t) => { setDate(d); setTime(t); }} />
      <Button className="mt-4 w-full" disabled={!date || !time} loading={busy} onClick={confirm}>
        {date && time ? `Confirm ${fmtTime(time)}, ${fmtDateLong(date)}` : "Choose a time"}
      </Button>
    </div>
  );
}
