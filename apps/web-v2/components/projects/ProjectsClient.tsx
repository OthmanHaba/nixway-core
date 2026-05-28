"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Boxes, ChevronRight, Plus } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Button } from "@/components/primitives/Button";
import { Badge } from "@/components/primitives/Badge";
import { EmptyState } from "@/components/primitives/EmptyState";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { projectsApi } from "@/lib/api";
import type { Cluster, Project } from "@/lib/types";

export function ProjectsClient({
  teamId,
  initialProjects,
  clusters,
}: {
  teamId: string;
  initialProjects: Project[];
  clusters: Cluster[];
}) {
  const projects = useQuery({
    queryKey: ["projects", teamId],
    queryFn: () => projectsApi.list(teamId),
    initialData: initialProjects,
  });

  const list = projects.data ?? [];
  const clusterMap = new Map(clusters.map((c) => [c.id, c] as const));

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Boxes className="h-4 w-4" />}
        title="No projects yet"
        body="A project groups apps that share a cluster, environments, and secrets. Create one to start deploying."
        action={
          <CreateProjectDialog
            teamId={teamId}
            clusters={clusters}
            trigger={
              <Button>
                <Plus className="h-3.5 w-3.5" /> Create project
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
          {list.length} {list.length === 1 ? "project" : "projects"}
        </div>
        <CreateProjectDialog
          teamId={teamId}
          clusters={clusters}
          trigger={
            <Button>
              <Plus className="h-3.5 w-3.5" /> Create project
            </Button>
          }
        />
      </div>

      <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>Project</TH>
              <TH>Cluster</TH>
              <TH>Status</TH>
              <TH>Description</TH>
              <TH>Created</TH>
              <TH align="right" className="w-8"> </TH>
            </TR>
          </THead>
          <TBody>
            {list.map((p) => {
              const cluster = clusterMap.get(p.cluster_id);
              return (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/projects/${p.id}`} className="block">
                      <div className="flex items-center gap-3">
                        <div className="h-7 w-7 grid place-items-center rounded-[3px] bg-surface-2 border border-line-1 text-ink-3">
                          <Boxes className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] text-ink-1 truncate">{p.name}</div>
                          <div className="font-mono text-[11px] text-ink-3 truncate">{p.slug}</div>
                        </div>
                      </div>
                    </Link>
                  </TD>
                  <TD>
                    {cluster ? (
                      <Link
                        href={`/clusters/${cluster.id}`}
                        className="font-mono text-[11px] text-ink-2 hover:text-signal transition-colors"
                      >
                        {cluster.name}
                      </Link>
                    ) : p.cluster_name ? (
                      <span className="font-mono text-[11px] text-ink-2">{p.cluster_name}</span>
                    ) : (
                      <span className="font-mono text-[11px] text-ink-4">unknown</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={p.status === "active" ? "online" : "neutral"} dot>
                      {p.status || "active"}
                    </Badge>
                  </TD>
                  <TD>
                    <span className="text-[12px] text-ink-3 truncate inline-block max-w-[220px] align-middle">
                      {p.description || "—"}
                    </span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-3 num">{formatDate(p.created_at)}</span>
                  </TD>
                  <TD align="right">
                    <Link
                      href={`/projects/${p.id}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                      aria-label="View project"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </TD>
                </TR>
              );
            })}
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
