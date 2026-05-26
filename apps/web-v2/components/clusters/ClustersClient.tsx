"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Network, Plus } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { ClusterStatusBadge } from "./ClusterStatusBadge";
import { CreateClusterDialog } from "./CreateClusterDialog";
import { clustersApi } from "@/lib/api";
import type { Cluster } from "@/lib/types";

export function ClustersClient({
  teamId,
  initialClusters,
}: {
  teamId: string;
  initialClusters: Cluster[];
}) {
  const clusters = useQuery({
    queryKey: ["clusters", teamId],
    queryFn: () => clustersApi.list(teamId),
    initialData: initialClusters,
  });

  const list = clusters.data ?? [];

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Network className="h-4 w-4" />}
        title="No clusters yet"
        body="A cluster links servers into a private WireGuard mesh with DNS. Create one and add servers to it."
        action={
          <CreateClusterDialog
            teamId={teamId}
            trigger={
              <Button>
                <Plus className="h-3.5 w-3.5" /> Create cluster
              </Button>
            }
          />
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          {list.length} {list.length === 1 ? "cluster" : "clusters"}
        </div>
        <CreateClusterDialog
          teamId={teamId}
          trigger={
            <Button>
              <Plus className="h-3.5 w-3.5" /> Create cluster
            </Button>
          }
        />
      </div>

      <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>Cluster</TH>
              <TH>Status</TH>
              <TH>Region</TH>
              <TH>CIDR</TH>
              <TH>Created</TH>
              <TH align="right" className="w-8"> </TH>
            </TR>
          </THead>
          <TBody>
            {list.map((c) => (
              <TR key={c.id}>
                <TD>
                  <Link href={`/clusters/${c.id}`} className="block">
                    <div className="flex items-center gap-3">
                      <div className="h-7 w-7 grid place-items-center rounded-[3px] bg-surface-2 border border-line-1 text-ink-3">
                        <Network className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] text-ink-1 truncate">{c.name}</div>
                        <div className="font-mono text-[11px] text-ink-3 truncate">{c.slug}</div>
                      </div>
                    </div>
                  </Link>
                </TD>
                <TD><ClusterStatusBadge status={c.status} /></TD>
                <TD>
                  <span className="font-mono text-[11px] text-ink-2 uppercase tracking-[0.14em]">
                    {c.region || "—"}
                  </span>
                </TD>
                <TD>
                  <span className="font-mono text-[11px] text-ink-2 num">{c.cidr || "—"}</span>
                </TD>
                <TD>
                  <span className="font-mono text-[11px] text-ink-3 num">{formatDate(c.created_at)}</span>
                </TD>
                <TD align="right">
                  <Link
                    href={`/clusters/${c.id}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                    aria-label="View cluster"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
