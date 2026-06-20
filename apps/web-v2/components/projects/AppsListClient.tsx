"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Box, ChevronRight, Github, Plus } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Badge } from "@/components/primitives/Badge";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { CreateAppDialog } from "@/components/apps/CreateAppDialog";
import { appsApi } from "@/lib/api";
import type { App } from "@/lib/types";

export function AppsListClient({
  projectId,
  teamId,
  initialApps,
}: {
  projectId: string;
  teamId?: string;
  initialApps: App[];
}) {
  const apps = useQuery({
    queryKey: ["project-apps", projectId],
    queryFn: () => appsApi.list(projectId),
    initialData: initialApps,
  });

  const list = apps.data ?? [];

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Boxes className="h-4 w-4" />}
        title="No apps yet"
        body="Apps are containers built from source or pulled from a registry. Wire one up to start deploying."
        action={
          <CreateAppDialog
            projectId={projectId}
            teamId={teamId}
            trigger={
              <Button>
                <Plus className="h-3.5 w-3.5" /> Create app
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
          {list.length} {list.length === 1 ? "app" : "apps"}
        </div>
        <CreateAppDialog
          projectId={projectId}
          teamId={teamId}
          trigger={
            <Button>
              <Plus className="h-3.5 w-3.5" /> Create app
            </Button>
          }
        />
      </div>

      <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>App</TH>
              <TH>Source</TH>
              <TH>Status</TH>
              <TH>Replicas</TH>
              <TH>Port</TH>
              <TH>Created</TH>
              <TH align="right" className="w-8"> </TH>
            </TR>
          </THead>
          <TBody>
            {list.map((app) => (
              <TR key={app.id}>
                <TD>
                  <Link href={`/apps/${app.id}`} className="block">
                    <div className="flex items-center gap-3">
                      <div className="h-7 w-7 grid place-items-center rounded-[3px] bg-surface-2 border border-line-1 text-ink-3">
                        <Boxes className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] text-ink-1 truncate">{app.name}</div>
                        <div className="font-mono text-[11px] text-ink-3 truncate">{app.slug}</div>
                      </div>
                    </div>
                  </Link>
                </TD>
                <TD><SourceCell app={app} /></TD>
                <TD>
                  <Badge tone={statusTone(app.status)} dot>
                    {app.status}
                  </Badge>
                </TD>
                <TD>
                  <span className="font-mono text-[12px] text-ink-1 num">
                    {app.replicas ?? "—"}
                  </span>
                </TD>
                <TD>
                  <span className="font-mono text-[12px] text-ink-2 num">
                    {app.port ?? "—"}
                  </span>
                </TD>
                <TD>
                  <span className="font-mono text-[11px] text-ink-3 num">{formatDate(app.created_at)}</span>
                </TD>
                <TD align="right">
                  <Link
                    href={`/apps/${app.id}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                    aria-label="View app"
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

function SourceCell({ app }: { app: App }) {
  if (app.source_type === "github") {
    return (
      <div className="flex items-center gap-2">
        <Github className="h-3 w-3 text-ink-3" />
        <span className="font-mono text-[11px] text-ink-2 truncate max-w-[200px]">
          {app.repo_full_name ?? "github"}
          {app.branch && <span className="text-ink-3"> · {app.branch}</span>}
        </span>
      </div>
    );
  }
  if (app.source_type === "docker_image") {
    return (
      <div className="flex items-center gap-2">
        <Box className="h-3 w-3 text-ink-3" />
        <span className="font-mono text-[11px] text-ink-2 truncate max-w-[200px]">
          {app.docker_image ?? "docker"}
        </span>
      </div>
    );
  }
  return <span className="font-mono text-[11px] text-ink-3">{app.source_type}</span>;
}

function statusTone(status: string): "online" | "warn" | "alert" | "neutral" | "info" {
  switch (status) {
    case "active":   return "online";
    case "deploying":
    case "building": return "info";
    case "paused":   return "warn";
    case "error":    return "alert";
    default:         return "neutral";
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
