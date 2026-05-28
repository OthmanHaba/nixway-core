"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Box,
  Database as DatabaseIcon,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/primitives/Badge";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/primitives/Table";
import type { Database } from "@/lib/types";
import { cn } from "@/lib/cn";

/** A flattened row decorated with its owning project's identity. */
export interface DatabaseWithProject extends Database {
  project_name: string;
  project_slug: string;
}

interface Props {
  rows: DatabaseWithProject[];
}

const STATUS_OPTIONS = ["running", "provisioning", "stopped", "error"];

export function TopDatabasesClient({ rows }: Props) {
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.project_id, r.project_name);
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (projectFilter === "" || r.project_id === projectFilter) &&
          (statusFilter === "" || r.status === statusFilter),
      ),
    [rows, projectFilter, statusFilter],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<DatabaseIcon className="h-4 w-4" />}
        title="No databases in this team"
        body="Provision a database from a project to manage stateful services across the cluster."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label-mono mr-2">Project</span>
          <FilterChip
            label="All"
            active={projectFilter === ""}
            onClick={() => setProjectFilter("")}
          />
          {projectOptions.map((p) => (
            <FilterChip
              key={p.id}
              label={p.name}
              active={projectFilter === p.id}
              onClick={() => setProjectFilter(p.id)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label-mono mr-2">Status</span>
          <FilterChip
            label="Any"
            active={statusFilter === ""}
            onClick={() => setStatusFilter("")}
          />
          {STATUS_OPTIONS.map((s) => (
            <FilterChip
              key={s}
              label={s}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
            />
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<DatabaseIcon className="h-4 w-4" />}
          title="No databases match this filter"
          body="Clear or change a filter to see more rows."
        />
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Database</TH>
                <TH>Project</TH>
                <TH>Engine</TH>
                <TH>Status</TH>
                <TH>Connection</TH>
                <TH>Resources</TH>
                <TH>Created</TH>
                <TH align="right" className="w-12"> </TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <Link
                      href={`/projects/${d.project_id}/databases/${d.id}`}
                      className="inline-flex items-center gap-2.5 hover:text-signal transition-colors"
                    >
                      <DatabaseIcon className="h-3.5 w-3.5 text-ink-3" />
                      <span className="font-mono text-[12px] text-ink-1">{d.name}</span>
                    </Link>
                  </TD>
                  <TD>
                    <Link
                      href={`/projects/${d.project_id}/databases`}
                      className="inline-flex items-center gap-1.5 hover:text-signal transition-colors"
                    >
                      <Box className="h-3 w-3 text-ink-3" />
                      <span className="font-mono text-[11px] text-ink-2">{d.project_name}</span>
                    </Link>
                  </TD>
                  <TD>
                    <span className="font-mono text-[12px] text-ink-1">{d.template_slug}</span>
                    <span className="font-mono text-[11px] text-ink-3 ml-1">{d.version}</span>
                  </TD>
                  <TD>
                    <Badge tone={dbTone(d.status)} dot={d.status === "running"}>
                      {d.status}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="font-mono text-[11px] text-ink-2 truncate max-w-[220px]">
                      {d.dns_record || d.container_name}
                    </div>
                    <div className="font-mono text-[10px] text-ink-4 num">port {d.port}</div>
                  </TD>
                  <TD>
                    <span className="font-mono text-[10px] text-ink-3 num">
                      {d.resource_cpu_millicores}m · {d.resource_memory_mb}Mi
                    </span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-3 num">
                      {formatDate(d.created_at)}
                    </span>
                  </TD>
                  <TD align="right">
                    <Link
                      href={`/projects/${d.project_id}/databases/${d.id}`}
                      className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                      aria-label="Open database"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "font-mono uppercase tracking-[0.14em] text-[10px] px-2 py-0.5 rounded-[3px] border transition-colors",
        active
          ? "border-signal text-[color:var(--signal-ink)] bg-[color:var(--signal-soft)]"
          : "border-line-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1",
      )}
    >
      {label}
    </button>
  );
}

function dbTone(status: string): "online" | "warn" | "alert" | "neutral" | "signal" {
  switch (status) {
    case "running":      return "online";
    case "provisioning": return "signal";
    case "stopped":      return "warn";
    case "error":
    case "deleted":      return "alert";
    default:             return "neutral";
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
