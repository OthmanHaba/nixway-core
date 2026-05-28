"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function TeamTabsNav({ teamId }: { teamId: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/teams/${teamId}/members`,    label: "Members" },
    { href: `/teams/${teamId}/tokens`,     label: "API Tokens" },
    { href: `/teams/${teamId}/secrets`,        label: "Secrets" },
    { href: `/teams/${teamId}/notifications`,  label: "Notifications" },
    { href: `/teams/${teamId}/audit-log`,       label: "Audit Log" },
    { href: `/teams/${teamId}/settings`,   label: "Settings" },
  ];

  return (
    <nav className="flex items-center gap-1 border-b border-line-1 -mx-1 px-1">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "relative px-3 py-2.5 -mb-px",
              "font-mono uppercase tracking-[0.14em] text-[11px]",
              "border-b-2 transition-colors",
              active
                ? "text-ink-1 border-signal"
                : "text-ink-3 hover:text-ink-1 border-transparent",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
