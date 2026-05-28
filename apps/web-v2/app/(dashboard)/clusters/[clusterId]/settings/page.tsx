import { notFound, redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { ClusterSettingsClient } from "@/components/clusters/ClusterSettingsClient";
import type { Cluster } from "@/lib/types";

export default async function ClusterSettingsPage({
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

  return <ClusterSettingsClient teamId={activeTeam.id} cluster={cluster} />;
}
