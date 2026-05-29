"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

type Item = { href: string; label: string };
type Group = { section: string; items: Item[] };

const NAV: Group[] = [
  {
    section: "Start",
    items: [
      { href: "/docs", label: "Welcome" },
      { href: "/docs/getting-started", label: "Getting started" },
      { href: "/docs/architecture", label: "Architecture" },
    ],
  },
  {
    section: "Concepts",
    items: [
      { href: "/docs/concepts/projects", label: "Projects & apps" },
      { href: "/docs/concepts/clusters", label: "Clusters & servers" },
      { href: "/docs/concepts/deployments", label: "Deployments" },
      { href: "/docs/concepts/networking", label: "Networking & mesh" },
    ],
  },
  {
    section: "Guides",
    items: [
      { href: "/docs/guides/aws-quickstart", label: "AWS quickstart" },
      { href: "/docs/guides/self-host", label: "Self-host the control plane" },
    ],
  },
  {
    section: "Reference",
    items: [
      { href: "/docs/cli", label: "CLI" },
      { href: "/docs/api", label: "HTTP API" },
    ],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex flex-col w-[228px] shrink-0 border-r border-line-1 bg-surface-1 min-h-[calc(100dvh-4rem)] sticky top-16 self-start">
      <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-6">
        {NAV.map((group) => (
          <div key={group.section}>
            <div className="px-2 mb-1.5 label-mono">{group.section}</div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5",
                        "text-[13px] transition-colors duration-[120ms]",
                        active
                          ? "bg-surface-3 text-ink-1"
                          : "text-ink-2 hover:text-ink-1 hover:bg-surface-2",
                      )}
                    >
                      <span>{item.label}</span>
                      {active && (
                        <span className="ml-auto inline-block h-1 w-1 rounded-full bg-signal" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="p-4 border-t border-line-1 text-[10px] font-mono uppercase tracking-[0.14em] text-ink-4 leading-relaxed">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-online" />
          docs · current
        </div>
      </div>
    </aside>
  );
}
