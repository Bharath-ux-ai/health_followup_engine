import Image from "next/image";
import { BellRing, CalendarCheck2, HeartPulse, Sparkles } from "lucide-react";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Left branding panel */}
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-[#0c0d12] via-[#12141c] to-[#181926] lg:flex lg:flex-col lg:justify-between lg:p-14">
        {/* Ambient background glow */}
        <div className="pointer-events-none absolute -top-40 -right-40 size-[560px] rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-48 -left-24 size-[480px] rounded-full bg-emerald-500/10 blur-[130px]" />

        <div className="relative">
          <Image src="/brand/logo-white.png" alt="TEC THA" width={280} height={140} className="h-auto w-[240px]" priority />
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-300">
            <Sparkles className="size-3.5 text-violet-400" />
            <span>Interactive Demo Ready</span>
          </div>
        </div>

        <div className="relative max-w-lg">
          <h2 className="text-[36px] leading-[1.18] font-extrabold tracking-tight text-white">
            Bring every follow-up patient <span className="bg-gradient-to-r from-violet-400 to-indigo-300 bg-clip-text text-transparent">back on time.</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-300">
            Online booking, WhatsApp reminders in Tamil &amp; English, and an intelligent dashboard highlighting missed follow-ups before patients drop out.
          </p>

          <ul className="mt-8 space-y-3.5 text-sm text-slate-200">
            {[
              [CalendarCheck2, "Shareable booking link with real-time doctor slots", "text-violet-400"],
              [BellRing, "Automated 7-day, 3-day and day-before WhatsApp reminders", "text-emerald-400"],
              [HeartPulse, "Red-alert tracking for overdue and unconfirmed patients", "text-rose-400"],
            ].map(([Icon, text, colorClass], i) => {
              const I = Icon as React.ElementType;
              return (
                <li key={i} className="flex items-center gap-3.5 rounded-xl border border-white/5 bg-white/5 p-2.5 backdrop-blur-xs">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 shadow-xs">
                    <I className={`size-4.5 ${colorClass}`} />
                  </span>
                  <span className="font-medium">{text as string}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="relative flex items-center justify-between text-xs text-slate-500">
          <span>TEC THA Follow-Up Engine · Version 1.0</span>
          <span>FastAPI + Next.js</span>
        </div>
      </section>

      {/* Right sign-in form panel */}
      <section className="flex flex-col items-center justify-center bg-white px-6 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <Image src="/brand/logo-mark.png" alt="TEC THA" width={48} height={36} className="h-9 w-auto" />
            <div>
              <div className="text-sm font-extrabold tracking-wide text-ink">TEC THA</div>
              <div className="text-xs text-muted">Follow-Up Engine</div>
            </div>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted leading-relaxed">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </section>
    </div>
  );
}
