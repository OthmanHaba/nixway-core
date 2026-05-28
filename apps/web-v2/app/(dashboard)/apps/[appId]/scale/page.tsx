import { notFound } from "next/navigation";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { getTeamContext } from "@/lib/team";
import { ScaleClient } from "@/components/apps/ScaleClient";
import type { App, ClusterMember, Project, ScalingEvent } from "@/lib/types";

export default async function AppScalePage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;

  let app: App;
  try {
    app = await serverApi.get<App>(`/apps/${appId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }

  // Resolve the team that owns this app via the active-team cookie so we can
  // look up the project's cluster and its members for the placement editor.
  const { activeTeam } = await getTeamContext();
  let members: ClusterMember[] = [];
  if (activeTeam) {
    const project = await tryGet<Project | null>(
      `/teams/${activeTeam.id}/projects/${app.project_id}`,
      null,
    );
    if (project?.cluster_id) {
      members = await tryGet<ClusterMember[]>(
        `/teams/${activeTeam.id}/clusters/${project.cluster_id}/members`,
        [],
      );
    }
  }

  const events = await tryGet<ScalingEvent[]>(`/apps/${appId}/scaling-events?limit=20`, []);

  return <ScaleClient app={app} members={members} initialEvents={events} />;
}
