"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, MessageCircle, Search, Users } from "lucide-react";
import { Badge } from "@/components/status";
import { Card, EmptyState, ErrorState, Input, Loading, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, fmtPhone } from "@/lib/format";
import { useData } from "@/lib/hooks";
import type { Paged, Patient } from "@/lib/types";

export default function PatientsPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, loading, reload } = useData(() => api.get<Paged<Patient>>("/patients", { q: query, page, page_size: 25 }), [query, page]);

  return (
    <div>
      <PageHeader title="Patients" subtitle="Patient lookup — contact details, consent and visit history" />
      <Card>
        <div className="border-b border-silver p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or mobile number" className="pl-9" aria-label="Search patients" autoFocus />
          </div>
        </div>
        {error ? <ErrorState text={error} onRetry={reload} /> : !data ? <Loading /> : data.items.length ? (
          <div className={loading ? "opacity-60" : ""}>
            <Table>
              <thead><tr><Th>Patient</Th><Th>Mobile</Th><Th>Language</Th><Th>WhatsApp</Th><Th>Appointments</Th><Th>Last visit date</Th><Th /></tr></thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className="hover:bg-off/60">
                    <Td>
                      <Link href={`/patients/${p.id}`} className="font-semibold hover:text-violet-800">{p.full_name}</Link>
                      {p.is_demo && <span className="ml-2 rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">DEMO</span>}
                    </Td>
                    <Td className="tabular">{fmtPhone(p.phone)}</Td>
                    <Td>{p.preferred_language === "ta" ? "Tamil" : "English"}</Td>
                    <Td>{p.whatsapp_consent ? <Badge tone="ok"><MessageCircle className="size-3" /> Consented</Badge> : <Badge>No consent</Badge>}</Td>
                    <Td className="tabular">{p.appointments ?? 0}</Td>
                    <Td className="tabular">{fmtDate(p.last_visit)}</Td>
                    <Td className="text-right"><Link href={`/patients/${p.id}`} className="inline-grid size-8 place-items-center rounded-lg text-slate hover:bg-silver/60" aria-label="Open"><ChevronRight className="size-4" /></Link></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </div>
        ) : (
          <EmptyState icon={<Users className="size-5" />} title={query ? "No matching patients" : "No patients yet"} text={query ? "Try part of the name or the last 4+ digits of the number." : "Patients are added automatically when they book."} />
        )}
      </Card>
    </div>
  );
}
