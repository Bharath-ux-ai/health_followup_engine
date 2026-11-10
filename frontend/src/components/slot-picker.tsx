"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { addDays, cx, fmtTime, parseDate, weekdayOf } from "@/lib/format";
import type { Slot } from "@/lib/types";
import { Spinner } from "@/components/ui";

/**
 * Date strip + time-slot grid. `slotsPath` is the endpoint that returns {slots} for ?doctor_id&date
 * (public booking, staff booking or a reschedule link).
 */
export function SlotPicker({
  slotsPath, doctorId, today, days = 21, weekdays, date, time, onChange, extraQuery,
}: {
  slotsPath: string;
  doctorId?: string;
  today: string;
  days?: number;
  weekdays?: number[];
  date: string | null;
  time: string | null;
  onChange: (date: string | null, time: string | null) => void;
  extraQuery?: Record<string, string>;
}) {
  const [offset, setOffset] = useState(0);
  const PER = 7;

  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(today, i)), [today, days]);
  const visible = dates.slice(offset, offset + PER);
  const works = (d: string) => !weekdays || weekdays.includes(weekdayOf(d));

  // Fetch slots for the chosen date; loading/error are derived from the request key (no setState inside the effect body).
  const extraKey = JSON.stringify(extraQuery || {});
  const canFetch = !!date && (!!doctorId || extraKey !== "{}" || slotsPath.includes("/actions/"));
  const reqKey = canFetch ? `${slotsPath}|${doctorId || ""}|${date}|${extraKey}` : null;
  const [res, setRes] = useState<{ key: string; slots: Slot[] | null; error: string | null }>({ key: "", slots: null, error: null });
  useEffect(() => {
    if (!reqKey || !date) return;
    let live = true;
    const extra = JSON.parse(extraKey) as Record<string, string>;
    api
      .get<{ slots: Slot[] }>(slotsPath, { ...(doctorId ? { doctor_id: doctorId } : {}), date, ...extra })
      .then(
        (r) => live && setRes({ key: reqKey, slots: r.slots, error: null }),
        (e) => live && setRes({ key: reqKey, slots: null, error: errorMessage(e) }),
      );
    return () => {
      live = false;
    };
  }, [reqKey, slotsPath, doctorId, date, extraKey]);
  const loading = !!reqKey && res.key !== reqKey;
  const slots = reqKey && res.key === reqKey ? res.slots : null;
  const error = reqKey && res.key === reqKey ? res.error : null;

  const groups = useMemo(() => {
    const g: Record<string, Slot[]> = { Morning: [], Afternoon: [], Evening: [] };
    (slots || []).forEach((s) => {
      const h = Number(s.start_time.slice(0, 2));
      g[h < 12 ? "Morning" : h < 16 ? "Afternoon" : "Evening"].push(s);
    });
    return Object.entries(g).filter(([, v]) => v.length);
  }, [slots]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Earlier dates" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PER))} className="grid size-9 shrink-0 place-items-center rounded-lg border border-silver-2 bg-white text-ink-2 disabled:opacity-30">
          <ChevronLeft className="size-4" />
        </button>
        <div className="grid flex-1 grid-cols-7 gap-1.5">
          {visible.map((d) => {
            const dt = parseDate(d);
            const ok = works(d);
            const sel = d === date;
            return (
              <button
                type="button"
                key={d}
                disabled={!ok}
                onClick={() => onChange(d, null)}
                className={cx(
                  "flex flex-col items-center rounded-xl border px-1 py-2 transition-colors",
                  sel ? "border-violet-700 bg-violet-700 text-white" : ok ? "border-silver-2 bg-white text-ink hover:border-violet" : "border-transparent bg-off text-slate line-through",
                )}
              >
                <span className={cx("text-[10px] font-bold tracking-wide uppercase", sel ? "text-white/80" : "text-muted")}>
                  {new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" }).format(dt)}
                </span>
                <span className="tabular text-lg leading-tight font-bold">{dt.getUTCDate()}</span>
                <span className={cx("text-[10px]", sel ? "text-white/80" : "text-muted")}>{new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(dt)}</span>
              </button>
            );
          })}
        </div>
        <button type="button" aria-label="Later dates" disabled={offset + PER >= dates.length} onClick={() => setOffset(offset + PER)} className="grid size-9 shrink-0 place-items-center rounded-lg border border-silver-2 bg-white text-ink-2 disabled:opacity-30">
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="mt-4 min-h-24">
        {!date ? (
          <p className="py-6 text-center text-sm text-muted">Choose a date to see available times.</p>
        ) : loading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : error ? (
          <p className="py-4 text-center text-sm text-danger">{error}</p>
        ) : !slots?.length ? (
          <p className="py-6 text-center text-sm text-muted">No consultation hours on this day. Please pick another date.</p>
        ) : !slots.some((s) => s.available) ? (
          <p className="py-6 text-center text-sm text-muted">This day is fully booked. Please pick another date.</p>
        ) : (
          <div className="space-y-3">
            {groups.map(([label, list]) => (
              <div key={label}>
                <div className="mb-1.5 text-[11px] font-bold tracking-wide text-muted uppercase">{label}</div>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-6">
                  {list.map((s) => (
                    <button
                      type="button"
                      key={s.start_time}
                      disabled={!s.available}
                      onClick={() => onChange(date, s.start_time)}
                      aria-pressed={time === s.start_time}
                      className={cx(
                        "tabular rounded-lg border px-2 py-2 text-[13px] font-semibold transition-colors",
                        time === s.start_time ? "border-violet-700 bg-violet-700 text-white" : s.available ? "border-silver-2 bg-white text-ink hover:border-violet hover:bg-violet-50" : "cursor-not-allowed border-transparent bg-off text-slate line-through",
                      )}
                    >
                      {fmtTime(s.start_time)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
