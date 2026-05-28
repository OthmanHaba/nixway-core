"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Boxes,
  CornerDownLeft,
  Database as DatabaseIcon,
  HardDrive,
  KeyRound,
  LayoutGrid,
  Network,
  Search,
  Server as ServerIcon,
  Settings,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogClose,
} from "@/components/primitives/Dialog";
import {
  appsApi,
  clustersApi,
  projectsApi,
  serversApi,
  volumesApi,
} from "@/lib/api";
import type { App, Database, Project } from "@/lib/types";
import { cn } from "@/lib/cn";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active team's id — used to scope team-bound resources (servers, clusters, volumes). */
  teamId: string | null;
}

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  href: string;
  icon: ReactNode;
}

const NAV_ITEMS: PaletteItem[] = [
  { id: "nav-overview",  group: "Navigate", label: "Overview",  href: "/dashboard",  icon: <LayoutGrid className="h-3.5 w-3.5" /> },
  { id: "nav-activity",  group: "Navigate", label: "Activity",  href: "/activity",   icon: <Activity   className="h-3.5 w-3.5" /> },
  { id: "nav-servers",   group: "Navigate", label: "Servers",   href: "/servers",    icon: <ServerIcon className="h-3.5 w-3.5" /> },
  { id: "nav-clusters",  group: "Navigate", label: "Clusters",  href: "/clusters",   icon: <Network    className="h-3.5 w-3.5" /> },
  { id: "nav-projects",  group: "Navigate", label: "Projects",  href: "/projects",   icon: <Boxes      className="h-3.5 w-3.5" /> },
  { id: "nav-databases", group: "Navigate", label: "Databases", href: "/databases",  icon: <DatabaseIcon className="h-3.5 w-3.5" /> },
  { id: "nav-volumes",   group: "Navigate", label: "Volumes",   href: "/volumes",    icon: <HardDrive  className="h-3.5 w-3.5" /> },
  { id: "nav-sshkeys",   group: "Navigate", label: "SSH Keys",  href: "/ssh-keys",   icon: <KeyRound   className="h-3.5 w-3.5" /> },
  { id: "nav-teams",     group: "Navigate", label: "Teams",     href: "/teams",      icon: <Users      className="h-3.5 w-3.5" /> },
  { id: "nav-settings",  group: "Navigate", label: "Settings",  href: "/settings",   icon: <Settings   className="h-3.5 w-3.5" /> },
];

export function CommandPalette({ open, onOpenChange, teamId }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch in parallel only when the palette has been opened at least once.
  // staleTime keeps the menu snappy on subsequent opens.
  const enabled = open;
  const projects = useQuery({
    queryKey: ["palette-projects", teamId],
    queryFn: () => projectsApi.list(teamId!),
    enabled: enabled && !!teamId,
    staleTime: 60_000,
  });
  const servers = useQuery({
    queryKey: ["palette-servers", teamId],
    queryFn: () => serversApi.list(teamId!),
    enabled: enabled && !!teamId,
    staleTime: 60_000,
  });
  const clusters = useQuery({
    queryKey: ["palette-clusters", teamId],
    queryFn: () => clustersApi.list(teamId!),
    enabled: enabled && !!teamId,
    staleTime: 60_000,
  });
  const volumes = useQuery({
    queryKey: ["palette-volumes", teamId],
    queryFn: () => volumesApi.list(teamId!),
    enabled: enabled && !!teamId,
    staleTime: 60_000,
  });

  // Apps + databases need a fan-out across projects. Only fan out once we have the project list.
  const appsQ = useQuery({
    queryKey: ["palette-apps", teamId, projects.data?.map((p) => p.id).join(",")],
    queryFn: async () => {
      const lists = await Promise.all(
        (projects.data ?? []).map(async (p) => {
          try {
            const apps = await appsApi.list(p.id);
            return apps.map((a) => ({ ...a, _project: p }));
          } catch {
            return [];
          }
        }),
      );
      return lists.flat();
    },
    enabled: enabled && !!projects.data,
    staleTime: 60_000,
  });
  const databasesQ = useQuery({
    queryKey: ["palette-databases", teamId, projects.data?.map((p) => p.id).join(",")],
    queryFn: async () => {
      const lists = await Promise.all(
        (projects.data ?? []).map(async (p) => {
          try {
            const dbs = await fetch(`/api/v1/projects/${p.id}/databases`, {
              credentials: "include",
              cache: "no-store",
            })
              .then((r) => (r.ok ? r.json() : []))
              .catch(() => []);
            return (Array.isArray(dbs) ? dbs : []).map((d: Database) => ({ ...d, _project: p }));
          } catch {
            return [];
          }
        }),
      );
      return lists.flat();
    },
    enabled: enabled && !!projects.data,
    staleTime: 60_000,
  });

  // Build the full searchable item list.
  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [...NAV_ITEMS];
    for (const p of projects.data ?? []) {
      out.push({
        id: `proj-${p.id}`,
        group: "Projects",
        label: p.name,
        hint: p.slug,
        href: `/projects/${p.id}/overview`,
        icon: <Boxes className="h-3.5 w-3.5" />,
      });
    }
    for (const a of (appsQ.data ?? []) as Array<App & { _project: Project }>) {
      out.push({
        id: `app-${a.id}`,
        group: "Apps",
        label: a.name,
        hint: a._project.name,
        href: `/apps/${a.id}/overview`,
        icon: <Boxes className="h-3.5 w-3.5" />,
      });
    }
    for (const s of servers.data ?? []) {
      out.push({
        id: `srv-${s.id}`,
        group: "Servers",
        label: s.name,
        hint: s.public_ip,
        href: `/servers/${s.id}/overview`,
        icon: <ServerIcon className="h-3.5 w-3.5" />,
      });
    }
    for (const c of clusters.data ?? []) {
      out.push({
        id: `clu-${c.id}`,
        group: "Clusters",
        label: c.name,
        hint: c.region,
        href: `/clusters/${c.id}/overview`,
        icon: <Network className="h-3.5 w-3.5" />,
      });
    }
    for (const d of (databasesQ.data ?? []) as Array<Database & { _project: Project }>) {
      out.push({
        id: `db-${d.id}`,
        group: "Databases",
        label: d.name,
        hint: `${d._project.name} · ${d.template_slug} ${d.version}`,
        href: `/projects/${d._project.id}/databases/${d.id}`,
        icon: <DatabaseIcon className="h-3.5 w-3.5" />,
      });
    }
    for (const v of volumes.data ?? []) {
      out.push({
        id: `vol-${v.id}`,
        group: "Volumes",
        label: v.name,
        hint: `${v.size_gb} GiB · ${v.status}`,
        href: `/volumes`,
        icon: <HardDrive className="h-3.5 w-3.5" />,
      });
    }
    return out;
  }, [projects.data, appsQ.data, servers.data, clusters.data, databasesQ.data, volumes.data]);

  // Apply the search filter — substring on label + hint, case-insensitive.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => {
      const hay = `${it.label} ${it.hint ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [items, query]);

  // Group results in original order; within a group, items keep their list order.
  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>();
    for (const it of filtered) {
      if (!map.has(it.group)) map.set(it.group, []);
      map.get(it.group)!.push(it);
    }
    return Array.from(map, ([group, list]) => ({ group, list }));
  }, [filtered]);

  // Flat result for keyboard navigation indices.
  const flat = filtered;
  const loading =
    enabled &&
    (projects.isLoading ||
      servers.isLoading ||
      clusters.isLoading ||
      volumes.isLoading ||
      appsQ.isLoading ||
      databasesQ.isLoading);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    // Focus the input slightly later than the Radix portal's mount.
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  // Keep the active row visible.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function go(it: PaletteItem) {
    onOpenChange(false);
    setQuery("");
    router.push(it.href);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = flat[active];
      if (it) go(it);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setQuery("");
      }}
    >
      <DialogContent className="max-w-[640px] p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-12 border-b border-line-1">
          <Search className="h-4 w-4 text-ink-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Jump to…"
            className="flex-1 bg-transparent outline-none border-none text-[14px] text-ink-1 placeholder:text-ink-4"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="font-mono text-[10px] tracking-[0.14em] text-ink-4">
            {loading ? "loading…" : `${flat.length}`}
          </span>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close"
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 hover:text-ink-1 border border-line-1 rounded px-1.5 py-0.5"
            >
              esc
            </button>
          </DialogClose>
        </div>

        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto"
          role="listbox"
          aria-label="Command palette results"
        >
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[13px] text-ink-3">
                {loading ? "Loading resources…" : "Nothing matches that search."}
              </p>
            </div>
          ) : (
            (() => {
              let runningIdx = 0;
              return groups.map((g) => (
                <div key={g.group} className="py-1.5">
                  <div className="px-4 py-1.5 label-mono text-ink-4">{g.group}</div>
                  {g.list.map((it) => {
                    const idx = runningIdx++;
                    const isActive = idx === active;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        data-idx={idx}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(it)}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                          isActive
                            ? "bg-[color:var(--signal-soft)]/30 text-ink-1"
                            : "text-ink-2 hover:bg-surface-2",
                        )}
                      >
                        <span className="text-ink-3">{it.icon}</span>
                        <span className="font-mono text-[12px] text-ink-1 truncate">
                          {it.label}
                        </span>
                        {it.hint && (
                          <span className="font-mono text-[10px] text-ink-4 truncate ml-auto">
                            {it.hint}
                          </span>
                        )}
                        {isActive && (
                          <CornerDownLeft className="h-3 w-3 text-ink-3 ml-2 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ));
            })()
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
