"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CalendarCheck2, Check, ChevronLeft, MapPin, MessageCircle, Phone, Stethoscope } from "lucide-react";
import { SlotPicker } from "@/components/slot-picker";
import { Button, Card, Checkbox, ErrorState, Field, Input, Loading, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cx, fmtDateLong, fmtPhone, fmtTime } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Doctor, Lang } from "@/lib/types";

interface HospitalPage {
  name: string; slug: string; city: string | null; address: string | null; phone: string | null;
  booking_enabled: boolean; booking_window_days: number; today: string; is_demo: boolean;
  doctors: (Doctor & { weekdays: number[] })[];
}
interface Confirmation { reference: string; date: string; start_time: string; doctor: string; hospital: string; address: string | null; phone: string | null; whatsapp_reminder: boolean }

export default function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: h, error, loading, reload } = useData(() => api.get<HospitalPage>(`/public/hospitals/${slug}`), [slug]);
  const [step, setStep] = useState(1);
  const [doctor, setDoctor] = useState<HospitalPage["doctors"][number] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [lang, setLang] = useState<Lang>("en");
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<Confirmation | null>(null);
  const [slotKey, setSlotKey] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!doctor || !date || !time) return;
    setBusy(true);
    setFormError(null);
    try {
      const r = await api.post<Confirmation>(`/public/hospitals/${slug}/appointments`, {
        full_name: name, phone, language: lang, whatsapp_consent: consent, doctor_id: doctor.id, date, start_time: time,
      });
      setDone(r);
    } catch (err) {
      setFormError(errorMessage(err));
      if ((err as { code?: string }).code === "slot_taken") {
        setTime(null);
        setStep(2);
        setSlotKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading && !h) return <Shell><Loading label="Loading booking page…" /></Shell>;
  if (error || !h) return <Shell><ErrorState text={error || "Booking page not found"} onRetry={reload} /></Shell>;

  return (
    <Shell hospital={h}>
      {done ? (
        <Card className="animate-rise overflow-hidden">
          <div className="bg-ok-50 px-6 py-6 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-ok text-white"><Check className="size-6" /></div>
            <h2 className="mt-3 text-xl font-bold">Appointment booked</h2>
            <p className="mt-1 text-sm text-muted">Please keep your appointment ID for reference.</p>
          </div>
          <dl className="divide-y divide-silver px-6 text-sm">
            {[
              ["Appointment ID", <span key="r" className="tabular font-mono text-base font-bold tracking-wider text-violet-800">{done.reference}</span>],
              ["Doctor", done.doctor],
              ["Date", fmtDateLong(done.date)],
              ["Time", fmtTime(done.start_time)],
              ["Hospital", <span key="h">{done.hospital}{done.address && <span className="block text-xs text-muted">{done.address}</span>}</span>],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-start justify-between gap-4 py-3">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="px-6 pb-6">
            {done.whatsapp_reminder ? (
              <Notice tone="ok" title="WhatsApp reminder">We will send you a reminder the day before your visit, with options to confirm or reschedule.</Notice>
            ) : (
              <Notice tone="info">You chose not to receive WhatsApp reminders. Please note your appointment time.</Notice>
            )}
            <Button variant="secondary" className="mt-4 w-full" onClick={() => { setDone(null); setStep(1); setDoctor(null); setDate(null); setTime(null); setName(""); setPhone(""); }}>
              Book another appointment
            </Button>
          </div>
        </Card>
      ) : !h.booking_enabled ? (
        <Card className="p-6"><Notice tone="warn" title="Online booking is closed">Please call {h.phone || "the hospital"} to book an appointment.</Notice></Card>
      ) : (
        <Card className="overflow-hidden">
          <ol className="flex border-b border-silver text-[12px] font-semibold">
            {["Doctor", "Date & time", "Your details"].map((s, i) => (
              <li key={s} className={cx("flex flex-1 items-center justify-center gap-2 py-3", step === i + 1 ? "text-violet-800" : step > i + 1 ? "text-ok" : "text-slate")}>
                <span className={cx("grid size-5 place-items-center rounded-full text-[11px]", step === i + 1 ? "bg-violet-700 text-white" : step > i + 1 ? "bg-ok text-white" : "bg-silver text-muted")}>
                  {step > i + 1 ? <Check className="size-3" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{s}</span>
              </li>
            ))}
          </ol>
          <div className="p-5 sm:p-6">
            {step === 1 && (
              <div className="animate-rise">
                <h2 className="text-lg font-bold">Choose a doctor</h2>
                <div className="mt-4 grid gap-2.5">
                  {h.doctors.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => { setDoctor(d); setDate(null); setTime(null); setStep(2); }}
                      className={cx("flex items-center gap-4 rounded-xl border p-4 text-left transition-colors hover:border-violet hover:bg-violet-50/50", doctor?.id === d.id ? "border-violet bg-violet-50" : "border-silver-2")}
                    >
                      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-700"><Stethoscope className="size-5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold">{d.name}</span>
                        <span className="block text-[13px] text-muted">{d.specialty}</span>
                      </span>
                      <span className="text-xs text-muted">{weekdaysLabel(d.weekdays)}</span>
                    </button>
                  ))}
                  {!h.doctors.length && <Notice tone="info">No doctors are taking online bookings right now. Please call the hospital.</Notice>}
                </div>
              </div>
            )}
            {step === 2 && doctor && (
              <div className="animate-rise">
                <BackLink onClick={() => setStep(1)} />
                <h2 className="text-lg font-bold">Pick a date and time</h2>
                <p className="mb-4 text-sm text-muted">{doctor.name} · {doctor.specialty}</p>
                {formError && <Notice tone="danger" className="mb-4">{formError}</Notice>}
                <SlotPicker key={slotKey} slotsPath={`/public/hospitals/${slug}/slots`} doctorId={doctor.id} today={h.today} days={Math.min(h.booking_window_days + 1, 42)} weekdays={doctor.weekdays} date={date} time={time} onChange={(d, t) => { setDate(d); setTime(t); setFormError(null); }} />
                <Button className="mt-5 w-full" disabled={!date || !time} onClick={() => setStep(3)}>Continue</Button>
              </div>
            )}
            {step === 3 && doctor && date && time && (
              <form onSubmit={submit} className="animate-rise space-y-4">
                <BackLink onClick={() => setStep(2)} />
                <div className="rounded-xl bg-off px-4 py-3 text-sm">
                  <div className="font-bold">{doctor.name}</div>
                  <div className="text-muted">{fmtDateLong(date)} · {fmtTime(time)}</div>
                </div>
                {formError && <Notice tone="danger">{formError}</Notice>}
                <Field label="Patient name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Full name" required minLength={2} maxLength={120} />
                </Field>
                <Field label="Mobile number (WhatsApp)" hint="10-digit Indian mobile number">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="98765 43210" required />
                </Field>
                <Field label="Reminder language">
                  <div className="grid grid-cols-2 gap-2">
                    {([["en", "English"], ["ta", "தமிழ் (Tamil)"]] as const).map(([v, l]) => (
                      <button type="button" key={v} onClick={() => setLang(v)} className={cx("rounded-lg border px-3 py-2 text-sm font-semibold", lang === v ? "border-violet-700 bg-violet-50 text-violet-800" : "border-silver-2 bg-white")}>{l}</button>
                    ))}
                  </div>
                </Field>
                <Checkbox checked={consent} onChange={setConsent} label={<span className="flex items-center gap-1.5"><MessageCircle className="size-4 text-ok" /> Send me appointment reminders on WhatsApp</span>} description={`${h.name} will message this number about your appointment and follow-up visits only. Reply STOP anytime to opt out.`} />
                <Button type="submit" loading={busy} className="w-full" disabled={!name.trim() || !phone.trim()}>
                  <CalendarCheck2 className="size-4" /> Confirm booking
                </Button>
                <p className="text-center text-[11px] text-muted">We only ask for your name and number — no medical details are collected online.</p>
              </form>
            )}
          </div>
        </Card>
      )}
    </Shell>
  );
}

function weekdaysLabel(days: number[]) {
  const n = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  if (days.length === 7) return "Every day";
  if (days.join() === "0,1,2,3,4,5") return "Mon–Sat";
  return days.map((d) => n[d]).join(", ");
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-3 flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink">
      <ChevronLeft className="size-4" /> Back
    </button>
  );
}

function Shell({ hospital, children }: { hospital?: HospitalPage; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-off">
      <header className="border-b border-silver bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-4 px-5 py-5">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"><Stethoscope className="size-6" /></div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold">{hospital?.name || "Book an appointment"}</h1>
            {hospital && (
              <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                {hospital.city && <span className="flex items-center gap-1"><MapPin className="size-3.5" />{hospital.city}</span>}
                {hospital.phone && <a href={`tel:${hospital.phone}`} className="flex items-center gap-1 hover:text-ink"><Phone className="size-3.5" />{fmtPhone(hospital.phone)}</a>}
              </p>
            )}
          </div>
        </div>
        {hospital?.is_demo && <div className="bg-violet-50 py-1.5 text-center text-[12px] font-semibold text-violet-800">Demo hospital — fictional data</div>}
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">{children}</main>
      <footer className="flex items-center justify-center gap-2 pb-8 text-[11px] text-muted">
        <Image src="/brand/logo-mark.png" alt="" width={22} height={16} className="h-3.5 w-auto opacity-70" /> Powered by TEC THA Follow-Up Engine
      </footer>
    </div>
  );
}
