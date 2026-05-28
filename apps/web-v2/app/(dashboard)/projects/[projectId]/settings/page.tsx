import { notFound, redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { ProjectSettingsClient } from "@/components/projects/ProjectSettingsClient";
import type { Project } from "@/lib/types";

export default async function ProjectSettingsPage({
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

  return <ProjectSettingsClient teamId={activeTeam.id} project={project} />;
}
