"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { RescheduleFlow } from "@/components/reschedule-flow";
import { Card } from "@/components/ui";

export default function ReschedulePage() {
  const { token } = useParams<{ token: string }>();
  return (
    <div className="min-h-dvh bg-off">
      <main className="mx-auto max-w-xl px-4 py-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-violet-50 text-violet-700"><CalendarClock className="size-5" /></div>
          <div>
            <h1 className="text-lg font-bold">Choose a new time</h1>
            <p className="text-[13px] text-muted">Pick a convenient slot — the hospital is updated instantly.</p>
          </div>
        </div>
        <Card className="p-5 sm:p-6">
          <RescheduleFlow token={token} />
        </Card>
        <p className="mt-6 flex items-center justify-center gap-2 text-[11px] text-muted">
          <Image src="/brand/logo-mark.png" alt="" width={22} height={16} className="h-3.5 w-auto opacity-70" /> Powered by TEC THA Follow-Up Engine
        </p>
      </main>
    </div>
  );
}
