import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { tryGet } from "@/lib/server-api";
import { MeshClient } from "@/components/clusters/MeshClient";
import type { MeshPeer } from "@/lib/types";

export default async function MeshPage({
  params,
}: {
  params: Promise<{ clusterId: string }>;
}) {
  const { clusterId } = await params;
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  const peers = await tryGet<MeshPeer[]>(
    `/teams/${activeTeam.id}/clusters/${clusterId}/mesh`,
    [],
  );

  return (
    <MeshClient teamId={activeTeam.id} clusterId={clusterId} initialPeers={peers} />
  );
}
