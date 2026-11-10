import Image from "next/image";
import { BellRing, CalendarCheck2, HeartPulse } from "lucide-react";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-violet/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-48 -left-24 size-[420px] rounded-full bg-[#4b6bfb]/10 blur-3xl" />
        <Image src="/brand/logo-white.png" alt="Tec Tha Consultancy Services" width={300} height={148} className="relative h-auto w-[260px]" priority />
        <div className="relative max-w-md">
          <h2 className="text-[34px] leading-[1.15] font-bold tracking-tight text-white">
            Bring every follow-up patient <span className="text-violet">back on time.</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/70">
            Online booking, WhatsApp reminders in Tamil and English, and a dashboard that shows exactly who needs a call today.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/85">
            {[
              [CalendarCheck2, "Shareable booking link with live slots"],
              [BellRing, "Day-before, 7-day and 3-day WhatsApp reminders"],
              [HeartPulse, "Missed follow-ups highlighted for your team"],
            ].map(([Icon, text], i) => {
              const I = Icon as React.ElementType;
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-lg bg-white/10"><I className="size-4 text-violet" /></span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">TEC THA Follow-Up Engine · Version 1</p>
      </section>
      <section className="flex flex-col items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <Image src="/brand/logo-mark.png" alt="TEC THA" width={64} height={46} className="mb-6 h-11 w-auto lg:hidden" />
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  );
}
