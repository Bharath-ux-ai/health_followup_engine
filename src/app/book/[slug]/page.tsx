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
        <Card className="animate-rise overflow-hidden border-emerald-200/80 shadow-md">
          <div className="bg-gradient-to-b from-emerald-600 to-emerald-700 px-6 py-8 text-center text-white">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-white text-emerald-600 shadow-md">
              <Check className="size-8 stroke-[3]" />
            </div>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight">Appointment Confirmed!</h2>
            <p className="mt-1 text-sm text-emerald-100">Please note your appointment reference ID.</p>
            <div className="mt-4 inline-block rounded-2xl bg-white/20 backdrop-blur-xs px-5 py-2.5 border border-white/30">
              <span className="text-[11px] uppercase tracking-wider text-emerald-100 block font-bold">Appointment ID</span>
              <span className="font-mono text-2xl font-extrabold tracking-widest text-white">{done.reference}</span>
            </div>
          </div>
          <dl className="divide-y divide-slate-100 px-6 py-2 text-sm bg-white">
            {[
              ["Doctor", done.doctor],
              ["Date", fmtDateLong(done.date)],
              ["Time", fmtTime(done.start_time)],
              ["Hospital", <span key="h">{done.hospital}{done.address && <span className="block text-xs text-muted">{done.address}</span>}</span>],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-start justify-between gap-4 py-3.5">
                <dt className="text-muted font-medium">{k}</dt>
                <dd className="text-right font-bold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="px-6 pb-6 pt-2 bg-white">
            {done.whatsapp_reminder ? (
              <Notice tone="ok" title="WhatsApp reminder active">We will send you a reminder on WhatsApp the day before your visit, with one-tap confirm and reschedule options.</Notice>
            ) : (
              <Notice tone="info">You chose not to receive WhatsApp reminders. Please note your appointment time.</Notice>
            )}
            <Button variant="secondary" className="mt-5 w-full h-11 text-[14px]" onClick={() => { setDone(null); setStep(1); setDoctor(null); setDate(null); setTime(null); setName(""); setPhone(""); }}>
              Book another appointment
            </Button>
          </div>
        </Card>
      ) : !h.booking_enabled ? (
        <Card className="p-6"><Notice tone="warn" title="Online booking is closed">Please call {h.phone || "the hospital"} to book an appointment.</Notice></Card>
      ) : (
        <Card className="overflow-hidden shadow-md">
          <ol className="flex border-b border-slate-100 bg-slate-50/70 p-1.5 text-[12px] font-bold">
            {["Doctor", "Date & time", "Your details"].map((s, i) => (
              <li
                key={s}
                className={cx(
                  "flex flex-1 items-center justify-center gap-2 py-2 rounded-xl transition-all",
                  step === i + 1
                    ? "bg-white text-violet-800 shadow-xs ring-1 ring-slate-200/70"
                    : step > i + 1
                    ? "text-emerald-700"
                    : "text-slate-400"
                )}
              >
                <span
                  className={cx(
                    "grid size-5 place-items-center rounded-full text-[11px] font-bold",
                    step === i + 1
                      ? "bg-violet-700 text-white"
                      : step > i + 1
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-200 text-slate-500"
                  )}
                >
                  {step > i + 1 ? <Check className="size-3 stroke-[3]" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{s}</span>
              </li>
            ))}
          </ol>
          <div className="p-5 sm:p-6">
            {step === 1 && (
              <div className="animate-rise">
                <h2 className="text-xl font-extrabold tracking-tight text-ink">Choose a doctor</h2>
                <p className="mt-1 text-sm text-muted">Select a specialist for your consultation.</p>
                <div className="mt-5 grid gap-3">
                  {h.doctors.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => { setDoctor(d); setDate(null); setTime(null); setStep(2); }}
                      className={cx(
                        "group flex items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-150 cursor-pointer select-none",
                        doctor?.id === d.id
                          ? "border-violet-600 bg-violet-50/80 ring-2 ring-violet-500/20 shadow-sm"
                          : "border-slate-200/90 bg-white hover:border-violet-300 hover:bg-slate-50/70 shadow-xs hover:-translate-y-0.5",
                      )}
                    >
                      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-700 font-bold group-hover:bg-violet-700 group-hover:text-white transition-colors shadow-xs">
                        <Stethoscope className="size-5.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-ink text-[15px]">{d.name}</span>
                        <span className="block text-[13px] text-muted font-medium">{d.specialty}</span>
                      </span>
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 group-hover:bg-violet-100 group-hover:text-violet-800 transition-colors">
                        {weekdaysLabel(d.weekdays)}
                      </span>
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
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 via-off to-slate-100/60 text-ink">
      <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md sticky top-0 z-10 shadow-xs">
        <div className="mx-auto flex max-w-xl items-center gap-4 px-5 py-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white shadow-xs">
            <Stethoscope className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-extrabold tracking-tight text-ink">{hospital?.name || "Book an appointment"}</h1>
            {hospital && (
              <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted font-medium">
                {hospital.city && <span className="flex items-center gap-1"><MapPin className="size-3.5 text-slate" />{hospital.city}</span>}
                {hospital.phone && <a href={`tel:${hospital.phone}`} className="flex items-center gap-1 hover:text-ink transition-colors"><Phone className="size-3.5 text-slate" />{fmtPhone(hospital.phone)}</a>}
              </p>
            )}
          </div>
        </div>
        {hospital?.is_demo && (
          <div className="border-t border-violet-100 bg-violet-50/90 py-1.5 px-4 text-center text-[12px] font-bold text-violet-800">
            🏥 TEC THA Multispeciality Clinic Demo · Live Slot Booking
          </div>
        )}
      </header>
      <main className="mx-auto max-w-xl px-4 py-8">{children}</main>
      <footer className="flex items-center justify-center gap-2 pb-10 text-[12px] text-muted font-medium">
        <Image src="/brand/logo-mark.png" alt="" width={22} height={16} className="h-3.5 w-auto opacity-70" /> Powered by TEC THA Follow-Up Engine
      </footer>
    </div>
  );
}
