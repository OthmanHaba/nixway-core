"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function AppTabsNav({ appId }: { appId: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/apps/${appId}/overview`,    label: "Overview" },
    { href: `/apps/${appId}/builds`,      label: "Builds" },
    { href: `/apps/${appId}/deployments`, label: "Deployments" },
    { href: `/apps/${appId}/traffic`,     label: "Traffic" },
    { href: `/apps/${appId}/logs`,        label: "Logs" },
    { href: `/apps/${appId}/scale`,       label: "Scale" },
    { href: `/apps/${appId}/autoscaling`, label: "Autoscale" },
    { href: `/apps/${appId}/resources`,   label: "Resources" },
    { href: `/apps/${appId}/variables`,   label: "Variables" },
    { href: `/apps/${appId}/domains`,     label: "Domains" },
    { href: `/apps/${appId}/settings`,    label: "Settings" },
  ];
  return (
    <div className="relative -mx-1 border-b border-line-1">
      <nav
        className="flex items-center gap-1 px-1 overflow-x-auto scrollbar-none whitespace-nowrap"
        aria-label="App sections"
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
      {/* Edge fades hint at scrollable overflow on narrow screens. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface-0 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface-0 to-transparent" />
    </div>
  );
}
