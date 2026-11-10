"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarCheck2, CalendarPlus, Search } from "lucide-react";
import { useAuth } from "@/components/providers";
import { AppointmentsTable } from "@/components/tables";
import { Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, Pagination, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { addDays } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Appointment, Doctor, Paged } from "@/lib/types";

const STATUSES = [
  ["", "All statuses"],
  ["booked", "Awaiting confirmation"],
  ["confirmed", "Confirmed"],
  ["reschedule_requested", "Wants to reschedule"],
  ["completed", "Completed"],
  ["no_show", "Missed (no-show)"],
  ["cancelled", "Cancelled"],
];

export default function AppointmentsPage() {
  const { me, can } = useAuth();
  const today = me?.hospital?.today || "";
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<"upcoming" | "today" | "week" | "past" | "all" | "custom">("upcoming");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [doctor, setDoctor] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setQuery(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const dates = (() => {
    switch (range) {
      case "today": return { date_from: today, date_to: today };
      case "upcoming": return { date_from: today };
      case "week": return { date_from: today, date_to: addDays(today, 6) };
      case "past": return { date_to: addDays(today, -1) };
      case "custom": return { date_from: from, date_to: to };
      default: return {};
    }
  })();

  const doctors = useData(() => api.get<Doctor[]>("/appointments/doctors"), []);
  const { data, error, loading, reload } = useData(
    () => api.get<Paged<Appointment>>("/appointments", { ...dates, q: query, status: status ? [status] : undefined, doctor_id: doctor, page, page_size: 25 }),
    [query, range, from, to, status, doctor, page, today],
  );

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle="Search, filter and manage every booking"
        actions={can("appointments.manage") && <Link href="/book-appointment"><Button icon={<CalendarPlus className="size-4" />}>Book appointment</Button></Link>}
      />
      <Card>
        <div className="grid gap-3 border-b border-silver p-4 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Patient name, phone or appointment ID" className="pl-9" aria-label="Search appointments" />
          </div>
          <Select value={range} onChange={(e) => { setRange(e.target.value as typeof range); setPage(1); }} aria-label="Date range">
            <option value="upcoming">Upcoming (from today)</option>
            <option value="today">Today</option>
            <option value="week">Next 7 days</option>
            <option value="past">Past</option>
            <option value="all">All dates</option>
            <option value="custom">Custom range…</option>
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select value={doctor} onChange={(e) => { setDoctor(e.target.value); setPage(1); }} aria-label="Doctor">
            <option value="">All doctors</option>
            {doctors.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          {range === "custom" && (
            <div className="flex items-center gap-2 md:col-span-4">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[180px]" aria-label="From" />
              <span className="text-sm text-muted">to</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[180px]" aria-label="To" />
            </div>
          )}
        </div>
        {error ? (
          <ErrorState text={error} onRetry={reload} />
        ) : !data ? (
          <Loading />
        ) : data.items.length ? (
          <div className={loading ? "opacity-60 transition-opacity" : ""}>
            <AppointmentsTable items={data.items} today={today} onChanged={reload} showDate />
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </div>
        ) : (
          <EmptyState icon={<CalendarCheck2 className="size-5" />} title="No appointments found" text="Try a different search, date range or status." />
        )}
      </Card>
    </div>
  );
}
