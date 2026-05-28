"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function ProjectTabsNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/projects/${projectId}/overview`,     label: "Overview" },
    { href: `/projects/${projectId}/apps`,         label: "Apps" },
    { href: `/projects/${projectId}/databases`,    label: "Databases" },
    { href: `/projects/${projectId}/environments`, label: "Environments" },
    { href: `/projects/${projectId}/settings`,     label: "Settings" },
  ];

  return (
    <div className="relative -mx-1 border-b border-line-1">
      <nav
        className="flex items-center gap-1 px-1 overflow-x-auto scrollbar-none whitespace-nowrap"
        aria-label="Project sections"
      >
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative px-3 py-2.5 -mb-px shrink-0",
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
      <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface-0 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface-0 to-transparent" />
    </div>
  );
}
