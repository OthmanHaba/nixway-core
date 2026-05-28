"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function ServerTabsNav({ serverId }: { serverId: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/servers/${serverId}/overview`,  label: "Overview" },
    { href: `/servers/${serverId}/tags`,      label: "Tags" },
    { href: `/servers/${serverId}/resources`, label: "Resources" },
    { href: `/servers/${serverId}/settings`,  label: "Settings" },
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
