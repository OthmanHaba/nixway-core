import { notFound } from "next/navigation";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { getTeamContext } from "@/lib/team";
import { DomainsClient } from "@/components/apps/DomainsClient";
import type {
  App,
  ClusterMember,
  Deployment,
  Project,
  Server,
} from "@/lib/types";

export default async function AppDomainsPage({
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

  const deployments = await tryGet<Deployment[]>(`/apps/${appId}/deployments`, []);
  const platformDomain =
    deployments.find((d) => !!d.platform_domain)?.platform_domain ?? null;

  let serverIps: string[] = [];
  let edgeIps: string[] = [];
  const { activeTeam } = await getTeamContext();
  if (activeTeam) {
    const project = await tryGet<Project | null>(
      `/teams/${activeTeam.id}/projects/${app.project_id}`,
      null,
    );
    if (project?.cluster_id) {
      const [members, servers] = await Promise.all([
        tryGet<ClusterMember[]>(
          `/teams/${activeTeam.id}/clusters/${project.cluster_id}/members`,
          [],
        ),
        tryGet<Server[]>(`/teams/${activeTeam.id}/servers`, []),
      ]);
      const memberIds = new Set(members.map((m) => m.server_id));
      const clusterServers = servers.filter((s) => memberIds.has(s.id) && s.public_ip);
      serverIps = clusterServers.map((s) => s.public_ip);
      edgeIps = clusterServers
        .filter((s) => s.role === "edge" || s.role === "both")
        .map((s) => s.public_ip);
    }
  }

  return (
    <DomainsClient
      app={app}
      platformDomain={platformDomain}
      serverIps={serverIps}
      edgeIps={edgeIps}
    />
  );
}
