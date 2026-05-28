import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { Github, Box } from "lucide-react";
import { getTeamContext } from "@/lib/team";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import { AppStatusBadge } from "@/components/apps/AppStatusBadge";
import { AppTabsNav } from "@/components/apps/AppTabsNav";
import type { App, Project } from "@/lib/types";

export default async function AppDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  let app: App;
  try {
    app = await serverApi.get<App>(`/apps/${appId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }

  // Best-effort project lookup for the crumb.
  const project = await tryGet<Project | null>(
    `/teams/${activeTeam.id}/projects/${app.project_id}`,
    null,
  );

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow={
          project ? (
            <Link
              href={`/projects/${project.id}/apps`}
              className="hover:text-signal transition-colors"
            >
              Workloads · {project.name}
            </Link>
          ) : (
            "Workloads · app"
          )
        }
        title={app.name}
        description={
          <span className="inline-flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[11px] text-ink-3">{app.slug}</span>
            <SourceChip app={app} />
            <AppStatusBadge status={app.status} />
          </span>
        }
      />
      <AppTabsNav appId={app.id} />
      <div className="pt-6">{children}</div>
    </div>
  );
}

function SourceChip({ app }: { app: App }) {
  if (app.source_type === "github") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 border border-line-1 rounded-[3px] px-1.5 py-0.5">
        <Github className="h-2.5 w-2.5" />
        {app.repo_full_name ?? "github"}
        {app.branch && <span className="text-ink-4 normal-case tracking-normal">· {app.branch}</span>}
      </span>
    );
  }
  if (app.source_type === "docker_image") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 border border-line-1 rounded-[3px] px-1.5 py-0.5">
        <Box className="h-2.5 w-2.5" />
        {app.docker_image ?? "docker"}
      </span>
    );
  }
  return null;
}
