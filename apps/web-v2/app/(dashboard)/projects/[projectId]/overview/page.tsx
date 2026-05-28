import { notFound, redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { ProjectOverview } from "@/components/projects/ProjectOverview";
import type { App, Environment, Project } from "@/lib/types";

export default async function OverviewPage({
  params,
}: {
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

  const [apps, environments] = await Promise.all([
    tryGet<App[]>(`/projects/${projectId}/apps`, []),
    tryGet<Environment[]>(`/projects/${projectId}/environments`, []),
  ]);

  return <ProjectOverview project={project} apps={apps} environments={environments} />;
}
