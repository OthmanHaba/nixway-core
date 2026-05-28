import { notFound, redirect } from "next/navigation";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { getTeamContext } from "@/lib/team";
import { DatabasesListClient } from "@/components/databases/DatabasesListClient";
import type { Database, Project, Template } from "@/lib/types";

export default async function ProjectDatabasesPage({
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

  const [databases, allTemplates] = await Promise.all([
    tryGet<Database[]>(`/projects/${projectId}/databases`, []),
    tryGet<Template[]>(`/templates`, []),
  ]);

  // Only list database-category templates here. Other categories (cache/queue)
  // could share the screen later, but the v1 surface targets DBs.
  const dbTemplates = allTemplates.filter((t) => t.category === "database");

  return (
    <DatabasesListClient
      project={project}
      initialDatabases={databases}
      templates={dbTemplates.length > 0 ? dbTemplates : allTemplates}
    />
  );
}
