"use client";

import { useQuery } from "@tanstack/react-query";
import { Boxes, Github, Box } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Badge } from "@/components/primitives/Badge";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Alert } from "@/components/primitives/Alert";
import { appsApi } from "@/lib/api";
import type { App } from "@/lib/types";

export function AppsListClient({
  projectId,
  initialApps,
}: {
  projectId: string;
  initialApps: App[];
}) {
  const apps = useQuery({
    queryKey: ["project-apps", projectId],
    queryFn: () => appsApi.list(projectId),
    initialData: initialApps,
  });

  const list = apps.data ?? [];

  return (
    <div className="space-y-6">
      <Alert tone="info" title="App creation lands in 3d-ii">
        This roster is read-only for now. The next phase wires the Create App dialog (GitHub
        repo or Docker image), env vars, build triggers, and deployment history with rollback.
      </Alert>

      {list.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-4 w-4" />}
          title="No apps yet"
          body="This project doesn't have any apps. The next phase adds the Create App dialog."
        />
      ) : (
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
              </TR>
            </THead>
            <TBody>
              {list.map((app) => (
                <TR key={app.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <div className="h-7 w-7 grid place-items-center rounded-[3px] bg-surface-2 border border-line-1 text-ink-3">
                        <Boxes className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] text-ink-1 truncate">{app.name}</div>
                        <div className="font-mono text-[11px] text-ink-3 truncate">{app.slug}</div>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <SourceCell app={app} />
                  </TD>
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
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
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
