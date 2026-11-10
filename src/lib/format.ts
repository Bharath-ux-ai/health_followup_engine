// Date/time helpers. Visit dates are plain "YYYY-MM-DD"; timestamps are ISO UTC rendered in the hospital timezone.

export const TZ_DEFAULT = "Asia/Kolkata";
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function parseDate(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const x = parseDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return isoDate(x);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

/** Monday = 0 … Sunday = 6 (matches the API). */
export function weekdayOf(d: string): number {
  return (parseDate(d).getUTCDay() + 6) % 7;
}

export function fmtDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(parseDate(d));
}

export function fmtDateLong(d: string | null | undefined): string {
  return fmtDate(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function fmtTime(t: string | null | undefined): string {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function fmtDateTime(iso: string | null | undefined, tz = TZ_DEFAULT): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz }).format(new Date(iso));
}

export function fmtClock(iso: string | null | undefined, tz = TZ_DEFAULT): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz }).format(new Date(iso));
}

export function fmtTimeOfIso(iso: string | null | undefined, tz = TZ_DEFAULT): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz }).format(new Date(iso));
}

export function localDateOfIso(iso: string, tz = TZ_DEFAULT): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(new Date(iso));
  return parts;
}

export function relativeDays(target: string, today: string): string {
  const n = daysBetween(today, target);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function maskPhone(p: string): string {
  return p.length > 8 ? `${p.slice(0, -6)}••${p.slice(-4)}` : p;
}

export function fmtPhone(p: string): string {
  if (p.startsWith("+91") && p.length === 13) {
    const n = p.slice(3);
    return /^[6-9]/.test(n) ? `+91 ${n.slice(0, 5)} ${n.slice(5)}` : `+91 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  return p;
}

export function monthLabel(y: number, m: number): string {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
}

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}
