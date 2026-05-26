import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, Boxes, Layers } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { Badge } from "@/components/primitives/Badge";
import type { App, Environment, Project } from "@/lib/types";

export function ProjectOverview({
  project,
  apps,
  environments,
}: {
  project: Project;
  apps: App[];
  environments: Environment[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Apps" value={apps.length} />
        <Stat label="Environments" value={environments.length} />
        <Stat
          label="Active apps"
          value={apps.filter((a) => a.status === "active").length}
          tone="online"
        />
        <Stat
          label="GitHub-linked"
          value={apps.filter((a) => a.source_type === "github").length}
          tone="info"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-6">
        <Card>
          <CardHeader>
            <div className="label-mono mb-1 flex items-center gap-2">
              <Layers className="h-3 w-3" /> Identity
            </div>
            <h2 className="text-[16px] text-ink-1">Project</h2>
          </CardHeader>
          <CardBody className="space-y-3 text-[12px]">
            <Row label="Slug"><span className="font-mono text-ink-1">{project.slug}</span></Row>
            <Row label="Created">
              <span className="font-mono text-ink-1 num">{formatDate(project.created_at)}</span>
            </Row>
            <Row label="Updated">
              <span className="font-mono text-ink-1 num">{formatDate(project.updated_at)}</span>
            </Row>
            {project.description && (
              <div className="pt-2 border-t border-line-1">
                <div className="label-mono mb-1.5">Description</div>
                <p className="text-[12px] text-ink-2 leading-relaxed">{project.description}</p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <div className="label-mono mb-1 flex items-center gap-2">
                  <Activity className="h-3 w-3" /> Apps
                </div>
                <h2 className="text-[16px] text-ink-1">Recent apps</h2>
              </div>
              <Link
                href={`/projects/${project.id}/apps`}
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 hover:text-signal transition-colors"
              >
                View all →
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {apps.length === 0 ? (
              <div className="py-6 text-center text-[13px] text-ink-3">
                No apps yet. App creation lands in the next phase.
              </div>
            ) : (
              <ul className="divide-y divide-line-1 -my-3">
                {apps.slice(0, 5).map((app) => (
                  <li key={app.id} className="py-3 flex items-center gap-3">
                    <div className="h-6 w-6 grid place-items-center rounded-[3px] bg-surface-2 border border-line-1 text-ink-3">
                      <Boxes className="h-3 w-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-ink-1 truncate">{app.name}</div>
                      <div className="font-mono text-[11px] text-ink-3 truncate">
                        {app.source_type === "github" && app.repo_full_name
                          ? app.repo_full_name
                          : app.docker_image ?? app.slug}
                      </div>
                    </div>
                    <Badge tone={app.status === "active" ? "online" : "neutral"} dot>
                      {app.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="label-mono">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "online" | "warn" | "info" | "neutral";
}) {
  const dot =
    tone === "online"
      ? "bg-online"
      : tone === "warn"
        ? "bg-warn"
        : tone === "info"
          ? "bg-info"
          : "bg-ink-4/40";
  return (
    <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="label-mono">{label}</span>
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      </div>
      <div className="font-mono text-3xl text-ink-1 num leading-none">
        {typeof value === "number" ? value.toString().padStart(2, "0") : value}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
