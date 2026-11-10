"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, ExternalLink, Stethoscope } from "lucide-react";
import { useAuth, useToast } from "@/components/providers";
import { SlotPicker } from "@/components/slot-picker";
import { Button, Card, CardHeader, Checkbox, ErrorState, Field, Input, Loading, Notice, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cx, fmtDateLong, fmtTime } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Appointment, Doctor, Lang } from "@/lib/types";

export default function BookAppointmentPage() {
  const { me } = useAuth();
  const toast = useToast();
  const h = me?.hospital;
  const doctors = useData(() => api.get<Doctor[]>("/appointments/doctors"), []);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [lang, setLang] = useState<Lang>("en");
  const [consent, setConsent] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Appointment | null>(null);
  const [k, setK] = useState(0);

  const bookingUrl = typeof window !== "undefined" && h ? `${window.location.origin}/book/${h.slug}` : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!doctor || !date || !time) return;
    setBusy(true);
    setErr(null);
    try {
      const a = await api.post<Appointment>("/appointments", { full_name: name, phone, language: lang, whatsapp_consent: consent, doctor_id: doctor.id, date, start_time: time, mark_confirmed: confirmed });
      setDone(a);
      toast.success(`Booked ${a.patient.full_name} — ${a.reference}`);
    } catch (e2) {
      setErr(errorMessage(e2));
      if ((e2 as { code?: string }).code === "slot_taken") { setTime(null); setK((x) => x + 1); }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDone(null); setDate(null); setTime(null); setName(""); setPhone(""); setConfirmed(false); setErr(null);
  }

  return (
    <div>
      <PageHeader title="Book appointment" subtitle="Register a patient at reception or over the phone" />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          {done ? (
            <div className="animate-rise p-8 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-full bg-ok text-white"><Check className="size-6" /></div>
              <h2 className="mt-3 text-xl font-bold">Appointment booked</h2>
              <p className="mt-1 text-sm text-muted">{done.patient.full_name} · {done.doctor.name} · {fmtDateLong(done.date)} at {fmtTime(done.start_time)}</p>
              <p className="mt-3 font-mono text-lg font-bold tracking-wider text-violet-800">{done.reference}</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Link href={`/appointments/${done.id}`}><Button variant="secondary">Open appointment</Button></Link>
                <Button onClick={reset}>Book another</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="divide-y divide-silver">
              <section className="p-5">
                <h2 className="mb-3 text-[15px] font-bold">1. Doctor</h2>
                {doctors.error ? <ErrorState text={doctors.error} onRetry={doctors.reload} /> : !doctors.data ? <Loading /> : (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {doctors.data.map((d) => (
                      <button type="button" key={d.id} onClick={() => { setDoctor(d); setDate(null); setTime(null); }}
                        className={cx("flex items-center gap-3 rounded-xl border p-3 text-left transition-colors", doctor?.id === d.id ? "border-violet-700 bg-violet-50" : "border-silver-2 hover:border-violet")}>
                        <Stethoscope className={cx("size-5 shrink-0", doctor?.id === d.id ? "text-violet-700" : "text-slate")} />
                        <span className="min-w-0"><span className="block truncate text-sm font-bold">{d.name}</span><span className="block truncate text-xs text-muted">{d.specialty}</span></span>
                      </button>
                    ))}
                    {!doctors.data.length && <Notice tone="warn">Add doctors and their consultation hours in Settings first.</Notice>}
                  </div>
                )}
              </section>
              {doctor && (
                <section className="p-5">
                  <h2 className="mb-3 text-[15px] font-bold">2. Date & time</h2>
                  <SlotPicker key={k} slotsPath="/appointments/slots" doctorId={doctor.id} today={h?.today || ""} days={42}
                    weekdays={[...new Set(doctor.availability?.map((w) => w.weekday))]} date={date} time={time} onChange={(d, t) => { setDate(d); setTime(t); }} />
                </section>
              )}
              {doctor && date && time && (
                <section className="animate-rise space-y-4 p-5">
                  <h2 className="text-[15px] font-bold">3. Patient</h2>
                  {err && <Notice tone="danger">{err}</Notice>}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Patient name"><Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} /></Field>
                    <Field label="Mobile number" hint="Existing patients are matched by name + number"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required /></Field>
                  </div>
                  <div className="flex gap-2">
                    {([["en", "English"], ["ta", "தமிழ்"]] as const).map(([v, l]) => (
                      <button type="button" key={v} onClick={() => setLang(v)} className={cx("rounded-lg border px-3 py-1.5 text-sm font-semibold", lang === v ? "border-violet-700 bg-violet-50 text-violet-800" : "border-silver-2")}>{l}</button>
                    ))}
                  </div>
                  <Checkbox checked={consent} onChange={setConsent} label="Patient agrees to WhatsApp reminders" description="Ask the patient. Consent is recorded with the date and source." />
                  <Checkbox checked={confirmed} onChange={setConfirmed} label="Mark as confirmed" description="Use when the patient has confirmed in person or on the phone." />
                  <Button type="submit" loading={busy} disabled={!name.trim() || !phone.trim()}>Book {fmtTime(time)}, {fmtDateLong(date)}</Button>
                </section>
              )}
            </form>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Online booking link" subtitle="Patients can book themselves — share it anywhere" />
          <div className="space-y-3 p-5">
            <div className="rounded-lg border border-silver bg-off px-3 py-2 font-mono text-[12px] break-all">{bookingUrl}</div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" icon={<Copy className="size-3.5" />} onClick={() => { navigator.clipboard?.writeText(bookingUrl); toast.success("Link copied"); }}>Copy</Button>
              <a href={bookingUrl} target="_blank" rel="noreferrer"><Button variant="secondary" size="sm" icon={<ExternalLink className="size-3.5" />}>Open</Button></a>
            </div>
            <p className="text-xs text-muted">The page shows only free times — never other patients&apos; details.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
