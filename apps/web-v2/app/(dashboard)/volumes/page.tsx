import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { tryGet } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import { VolumesClient } from "@/components/volumes/VolumesClient";
import type { Cluster, Server, Volume } from "@/lib/types";

export const metadata = { title: "Volumes · Nixway Core" };

export default async function VolumesPage() {
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  const [volumes, clusters, servers] = await Promise.all([
    tryGet<Volume[]>(`/teams/${activeTeam.id}/volumes`, []),
    tryGet<Cluster[]>(`/teams/${activeTeam.id}/clusters`, []),
    tryGet<Server[]>(`/teams/${activeTeam.id}/servers`, []),
  ]);

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Workloads · storage"
        title="Volumes"
        description="Persistent block storage that survives container restarts. Attach to apps to back stateful workloads."
      />
      <div className="reveal reveal-2">
        <VolumesClient
          teamId={activeTeam.id}
          initialVolumes={volumes}
          clusters={clusters}
          servers={servers}
        />
      </div>
    </div>
  );
}
