import {
  LayoutGrid,
  Server,
  Network,
  Boxes,
  Database,
  HardDrive,
  KeyRound,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/cn";

export type DemoPage =
  | "overview"
  | "servers"
  | "clusters"
  | "projects"
  | "databases";

const NAV: { page: DemoPage; label: string; icon: typeof Server; section: string }[] = [
  { section: "Control",        page: "overview",  label: "Overview",  icon: LayoutGrid },
  { section: "Infrastructure", page: "servers",   label: "Servers",   icon: Server },
  { section: "Infrastructure", page: "clusters",  label: "Clusters",  icon: Network },
  { section: "Workloads",      page: "projects",  label: "Projects",  icon: Boxes },
  { section: "Workloads",      page: "databases", label: "Databases", icon: Database },
];

const STATIC_NAV: { label: string; icon: typeof Server; section: string }[] = [
  { section: "Workloads", label: "Volumes",  icon: HardDrive },
  { section: "Access",    label: "SSH Keys", icon: KeyRound },
  { section: "Access",    label: "Settings", icon: Settings },
];

export function ConsoleChrome({
  activePage,
  children,
}: {
  activePage: DemoPage;
  children: React.ReactNode;
}) {
  const sections = ["Control", "Infrastructure", "Workloads", "Access"];

  return (
    <div className="bg-surface-0 border-t border-line-1">
      {/* Topbar */}
      <div className="flex items-center justify-between h-10 px-4 border-b border-line-1 bg-surface-1 shrink-0">
        <div className="flex items-center gap-3">
          <span className="flex items-baseline gap-1.5">
            <span className="inline-block h-2 w-2 rounded-[2px] bg-signal" />
            <span className="font-mono uppercase tracking-[0.18em] text-[10px] text-ink-1">
              Nixway
            </span>
            <span className="font-mono uppercase tracking-[0.18em] text-[10px] text-ink-3">
              {"//core"}
            </span>
          </span>
          <span className="hidden sm:inline-flex items-center gap-1.5 h-6 px-2 rounded-[3px] border border-line-1 bg-surface-2 text-[10px] font-mono uppercase tracking-[0.14em] text-ink-2">
            <span className="h-1 w-1 rounded-full bg-online" />
            orbit
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:block text-[10px] font-mono uppercase tracking-[0.14em] text-ink-4">
            ada@orbit.co
          </span>
          <span className="h-5 w-5 rounded-full bg-surface-3 grid place-items-center text-[10px] font-mono text-signal">
            A
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="grid grid-cols-[64px_1fr] sm:grid-cols-[180px_1fr] min-h-[460px] sm:min-h-[480px]">
        {/* Sidebar */}
        <aside className="border-r border-line-1 bg-surface-1 py-4 px-2 space-y-4">
          {sections.map((sec) => {
            const items = [
              ...NAV.filter((n) => n.section === sec),
              ...STATIC_NAV.filter((n) => n.section === sec),
            ];
            if (items.length === 0) return null;
            return (
              <div key={sec}>
                <div className="hidden sm:block px-2 mb-1 font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
                  {sec}
                </div>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const active = "page" in item && item.page === activePage;
                    return (
                      <li key={item.label}>
                        <span
                          className={cn(
                            "flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] text-[11px] transition-colors duration-300",
                            active
                              ? "bg-surface-3 text-ink-1"
                              : "text-ink-2",
                          )}
                        >
                          <item.icon
                            className={cn(
                              "h-3 w-3 shrink-0 transition-colors duration-300",
                              active ? "text-signal" : "text-ink-3",
                            )}
                          />
                          <span className="hidden sm:inline">{item.label}</span>
                          {active && (
                            <span className="hidden sm:inline ml-auto h-1 w-1 rounded-full bg-signal" />
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </aside>

        {/* Page content */}
        <div className="relative overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
