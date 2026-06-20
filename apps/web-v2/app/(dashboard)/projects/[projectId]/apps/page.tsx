import { tryGet } from "@/lib/server-api";
import { getTeamContext } from "@/lib/team";
import { AppsListClient } from "@/components/projects/AppsListClient";
import type { App } from "@/lib/types";

export default async function ProjectAppsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [apps, { activeTeam }] = await Promise.all([
    tryGet<App[]>(`/projects/${projectId}/apps`, []),
    getTeamContext(),
  ]);
  return (
    <AppsListClient projectId={projectId} teamId={activeTeam?.id} initialApps={apps} />
  );
}
