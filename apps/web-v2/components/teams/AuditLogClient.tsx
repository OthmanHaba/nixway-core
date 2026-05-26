"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Filter, RotateCcw, Search } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Badge } from "@/components/primitives/Badge";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Input } from "@/components/primitives/Input";
import { Alert } from "@/components/primitives/Alert";
import { auditApi, ApiError } from "@/lib/api";
import type { AuditLog } from "@/lib/types";

const PAGE_SIZE = 50;

export function AuditLogClient({
  teamId,
  initialEntries,
}: {
  teamId: string;
  initialEntries: AuditLog[];
}) {
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<{ action?: string; resource_type?: string }>({});
  const [loadedPages, setLoadedPages] = useState<AuditLog[][]>([initialEntries]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh page 0 when filters change.
  const page0 = useQuery({
    queryKey: ["audit-log", teamId, appliedFilters],
    queryFn: () => auditApi.list(teamId, { ...appliedFilters, page_size: PAGE_SIZE }),
    initialData: initialEntries,
  });

  // Compose all pages: page0 (live) + subsequent pages loaded manually.
  const entries = useMemo(() => {
    const head = page0.data ?? [];
    return [head, ...loadedPages.slice(1)].flat();
  }, [page0.data, loadedPages]);

  const hasMore = (page0.data?.length ?? 0) === PAGE_SIZE && (loadedPages.at(-1)?.length ?? PAGE_SIZE) === PAGE_SIZE;

  function applyFilters() {
    setAppliedFilters({
      action: actionFilter.trim() || undefined,
      resource_type: resourceFilter.trim() || undefined,
    });
    setLoadedPages([initialEntries]);
  }

  function resetFilters() {
    setActionFilter("");
    setResourceFilter("");
    setAppliedFilters({});
    setLoadedPages([initialEntries]);
  }

  async function loadMore() {
    const last = entries.at(-1);
    if (!last) return;
    setError(null);
    setPending(true);
    try {
      const next = await auditApi.list(teamId, {
        ...appliedFilters,
        before: last.created_at,
        page_size: PAGE_SIZE,
      });
      setLoadedPages((prev) => [...prev, next]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load more entries.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1 min-w-0">
          <div className="label-mono mb-1.5">Filter by action</div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-ink-3 absolute left-0 top-1/2 -translate-y-1/2" />
            <Input
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              placeholder="e.g. team.create, member.invite"
              className="pl-6"
            />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="label-mono mb-1.5">Resource type</div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-ink-3 absolute left-0 top-1/2 -translate-y-1/2" />
            <Input
              value={resourceFilter}
              onChange={(e) => setResourceFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              placeholder="e.g. team, server, app"
              className="pl-6"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={applyFilters}>
            <Filter className="h-3.5 w-3.5" /> Apply
          </Button>
          {(appliedFilters.action || appliedFilters.resource_type) && (
            <Button type="button" variant="ghost" onClick={resetFilters}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {/* table */}
      {entries.length === 0 ? (
        <EmptyState
          title="No audit events"
          body={
            appliedFilters.action || appliedFilters.resource_type
              ? "Nothing matches the current filters."
              : "Activity from this team will appear here as the platform is used."
          }
          action={
            appliedFilters.action || appliedFilters.resource_type ? (
              <Button variant="secondary" onClick={resetFilters}>
                <RotateCcw className="h-3.5 w-3.5" /> Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Actor</TH>
                  <TH>Action</TH>
                  <TH>Resource</TH>
                  <TH>IP</TH>
                </TR>
              </THead>
              <TBody>
                {entries.map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <time className="font-mono text-[11px] text-ink-3 num">
                        {formatTimestamp(e.created_at)}
                      </time>
                    </TD>
                    <TD>
                      <div className="min-w-0">
                        <div className="text-[12px] text-ink-1 truncate">
                          {e.actor_name || e.actor_email || (
                            <span className="text-ink-3 italic">system</span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.14em]">
                          {e.actor_type}
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={toneForAction(e.action)}>{e.action}</Badge>
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-2">{e.resource_type}</span>
                      {e.resource_id && (
                        <span className="font-mono text-[10px] text-ink-4 ml-1">
                          · {e.resource_id.slice(0, 8)}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3 num">{e.ip_address || "—"}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-[11px] text-ink-3">
            <span className="font-mono">Showing {entries.length} entries</span>
            {hasMore && (
              <Button variant="secondary" size="sm" onClick={loadMore} loading={pending}>
                Load more
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function toneForAction(action: string): "online" | "warn" | "alert" | "neutral" {
  if (action.includes("delete") || action.includes("remove") || action.includes("revoke"))
    return "alert";
  if (action.includes("create") || action.includes("invite") || action.includes("login"))
    return "online";
  if (action.includes("update") || action.includes("rotate") || action.includes("change"))
    return "warn";
  return "neutral";
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
