import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { getTeamContext } from "@/lib/team";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import { Badge } from "@/components/primitives/Badge";
import { ProjectTabsNav } from "@/components/projects/ProjectTabsNav";
import type { Cluster, Project } from "@/lib/types";

export default async function ProjectDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  let project: Project;
  try {
    project = await serverApi.get<Project>(`/teams/${activeTeam.id}/projects/${projectId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }

  // Best-effort enrich with cluster name. Skipped on error.
  const clusters = await tryGet<Cluster[]>(`/teams/${activeTeam.id}/clusters`, []);
  const cluster = clusters.find((c) => c.id === project.cluster_id);

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Workloads · project"
        title={project.name}
        description={
          <span className="inline-flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[11px] text-ink-3">{project.slug}</span>
            {cluster ? (
              <Link
                href={`/clusters/${cluster.id}`}
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 hover:text-signal transition-colors border border-line-1 rounded-[3px] px-1.5 py-0.5"
              >
                cluster · {cluster.name}
              </Link>
            ) : null}
            <Badge tone={project.status === "active" ? "online" : "neutral"} dot>
              {project.status || "active"}
            </Badge>
          </span>
        }
      />
      <ProjectTabsNav projectId={project.id} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
