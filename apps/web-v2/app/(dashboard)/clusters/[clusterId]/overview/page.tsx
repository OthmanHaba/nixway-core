import { notFound, redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { serverApi, tryGet, ServerApiError } from "@/lib/server-api";
import { ClusterOverview } from "@/components/clusters/ClusterOverview";
import type { Cluster, ClusterMember } from "@/lib/types";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ clusterId: string }>;
}) {
  const { clusterId } = await params;
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  let cluster: Cluster;
  try {
    cluster = await serverApi.get<Cluster>(`/teams/${activeTeam.id}/clusters/${clusterId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
  const members = await tryGet<ClusterMember[]>(
    `/teams/${activeTeam.id}/clusters/${clusterId}/members`,
    [],
  );

  return <ClusterOverview cluster={cluster} members={members} />;
}
