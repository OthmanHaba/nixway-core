import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { tryGet } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import { ClustersClient } from "@/components/clusters/ClustersClient";
import type { Cluster } from "@/lib/types";

export const metadata = { title: "Clusters · Nixway Core" };

export default async function ClustersPage() {
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  const clusters = await tryGet<Cluster[]>(`/teams/${activeTeam.id}/clusters`, []);

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Infrastructure · network"
        title="Clusters"
        description="Each cluster wires a set of servers into a private WireGuard mesh. Add members to the cluster and they show up in the mesh matrix."
      />
      <div className="reveal reveal-2">
        <ClustersClient teamId={activeTeam.id} initialClusters={clusters} />
      </div>
    </div>
  );
}
