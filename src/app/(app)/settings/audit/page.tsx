"use client";

import { useState } from "react";
import { Card, EmptyState, ErrorState, Loading, Pagination, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useData } from "@/lib/hooks";

interface Entry { action: string; entity_type: string | null; entity_id: string | null; details: Record<string, unknown> | null; user: string | null; ip: string | null; at: string }

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useData(() => api.get<Entry[]>("/audit", { page }), [page]);
  if (!data) return error ? <ErrorState text={error} onRetry={reload} /> : <Loading />;
  return (
    <Card>
      <div className="border-b border-silver px-5 py-3 text-[13px] text-muted">Every sign-in, patient record view, status change and configuration change is recorded. Phone numbers and secrets are never written to the log.</div>
      {data.length ? (
        <>
          <Table>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Details</Th></tr></thead>
            <tbody>
              {data.map((e, i) => (
                <tr key={i}>
                  <Td className="tabular text-xs whitespace-nowrap">{fmtDateTime(e.at)}</Td>
                  <Td className="text-[13px]">{e.user || <span className="text-muted">System / patient</span>}{e.ip && <span className="block text-[11px] text-muted">{e.ip}</span>}</Td>
                  <Td><code className="rounded bg-off px-1.5 py-0.5 text-[12px]">{e.action}</code></Td>
                  <Td className="max-w-[420px] truncate text-xs text-muted" title={JSON.stringify(e.details)}>{e.details ? Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") : e.entity_type}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={50} total={data.length === 50 ? page * 50 + 1 : (page - 1) * 50 + data.length} onPage={setPage} />
        </>
      ) : <EmptyState title="No activity yet" />}
    </Card>
  );
}
