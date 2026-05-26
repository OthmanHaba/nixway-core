import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getTeamContext } from "@/lib/team";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import { ClusterStatusBadge } from "@/components/clusters/ClusterStatusBadge";
import { ClusterTabsNav } from "@/components/clusters/ClusterTabsNav";
import type { Cluster } from "@/lib/types";

export default async function ClusterDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
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

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Infrastructure · cluster"
        title={cluster.name}
        description={
          <span className="inline-flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[11px] text-ink-3">{cluster.slug}</span>
            {cluster.region && (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 border border-line-1 rounded-[3px] px-1.5 py-0.5">
                {cluster.region}
              </span>
            )}
            <ClusterStatusBadge status={cluster.status} />
          </span>
        }
      />
      <ClusterTabsNav clusterId={cluster.id} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
