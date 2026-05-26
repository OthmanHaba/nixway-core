import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { tryGet } from "@/lib/server-api";
import { MembersClient } from "@/components/clusters/MembersClient";
import type { ClusterMember, Server } from "@/lib/types";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ clusterId: string }>;
}) {
  const { clusterId } = await params;
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  const [members, allServers] = await Promise.all([
    tryGet<ClusterMember[]>(`/teams/${activeTeam.id}/clusters/${clusterId}/members`, []),
    tryGet<Server[]>(`/teams/${activeTeam.id}/servers`, []),
  ]);

  return (
    <MembersClient
      teamId={activeTeam.id}
      clusterId={clusterId}
      initialMembers={members}
      allServers={allServers}
    />
  );
}
