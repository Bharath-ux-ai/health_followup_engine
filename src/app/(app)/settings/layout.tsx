"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { cx } from "@/lib/format";

const TABS = [
  { href: "/settings", label: "Hospital profile" },
  { href: "/settings/doctors", label: "Doctors & schedules" },
  { href: "/settings/staff", label: "Staff" },
  { href: "/settings/whatsapp", label: "WhatsApp" },
  { href: "/settings/templates", label: "Message templates" },
  { href: "/settings/audit", label: "Audit log" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div>
      <PageHeader title="Settings" subtitle="Hospital profile, schedules, staff accounts and WhatsApp integration" />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-silver" aria-label="Settings">
        {TABS.map((t) => {
          const active = t.href === "/settings" ? path === "/settings" : path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className={cx("-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[14px] font-semibold", active ? "border-violet-700 text-violet-800" : "border-transparent text-muted hover:text-ink")}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
