"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Server,
  Network,
  Boxes,
  Database,
  HardDrive,
  KeyRound,
  Settings,
  Users,
  Activity,
} from "lucide-react";
import { Logo } from "./Logo";
import { TeamSwitcher } from "./TeamSwitcher";
import { Separator } from "@/components/primitives/Separator";
import { cn } from "@/lib/cn";
import type { Team } from "@/lib/types";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; section: string };

const NAV: NavItem[] = [
  { section: "Control",        href: "/dashboard",  label: "Overview",  icon: LayoutGrid },
  { section: "Control",        href: "/activity",   label: "Activity",  icon: Activity },

  { section: "Infrastructure", href: "/servers",    label: "Servers",   icon: Server },
  { section: "Infrastructure", href: "/clusters",   label: "Clusters",  icon: Network },

  { section: "Workloads",      href: "/projects",   label: "Projects",  icon: Boxes },
  { section: "Workloads",      href: "/databases",  label: "Databases", icon: Database },
  { section: "Workloads",      href: "/volumes",    label: "Volumes",   icon: HardDrive },

  { section: "Access",         href: "/ssh-keys",   label: "SSH Keys",  icon: KeyRound },
  { section: "Access",         href: "/teams",      label: "Teams",     icon: Users },
  { section: "Access",         href: "/settings",   label: "Settings",  icon: Settings },
];

interface SidebarProps {
  teams: Team[];
  activeTeam: Team | null;
}

export function Sidebar({ teams, activeTeam }: SidebarProps) {
  const pathname = usePathname();
  const sections = Array.from(new Set(NAV.map((n) => n.section)));

  return (
    <aside className="hidden md:flex flex-col w-[228px] shrink-0 border-r border-line-1 bg-surface-1">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <Link href="/dashboard" className="px-2"><Logo /></Link>
      </div>
      <div className="px-3 pb-3">
        <TeamSwitcher teams={teams} activeTeam={activeTeam} />
      </div>
      <Separator />

      <nav className="flex-1 overflow-y-auto py-5 px-3 space-y-6">
        {sections.map((section) => (
          <div key={section}>
            <div className="px-2 mb-1.5 label-mono">{section}</div>
            <ul className="space-y-0.5">
              {NAV.filter((n) => n.section === section).map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5",
                        "text-[13px] transition-colors duration-[120ms]",
                        active
                          ? "bg-surface-3 text-ink-1"
                          : "text-ink-2 hover:text-ink-1 hover:bg-surface-2",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          active ? "text-signal" : "text-ink-3 group-hover:text-ink-2",
                        )}
                      />
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

      <Separator />
      <div className="p-4 text-[10px] font-mono uppercase tracking-[0.14em] text-ink-4 leading-relaxed">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-online" />
          API · online
        </div>
        <div className="mt-1">build · 0.4.0-rc1</div>
      </div>
    </aside>
  );
}
