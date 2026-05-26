import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getTeamContext } from "@/lib/team";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import { ServerStatusBadge } from "@/components/servers/ServerStatusBadge";
import { ServerTabsNav } from "@/components/servers/ServerTabsNav";
import type { ServerDetail } from "@/lib/types";

interface Params { serverId: string }

async function fetchServer(teamId: string, serverId: string): Promise<ServerDetail | null> {
  try {
    return await serverApi.get<ServerDetail>(`/teams/${teamId}/servers/${serverId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) {
      return null;
    }
    throw err;
  }
}

export default async function ServerDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<Params>;
}) {
  const { serverId } = await params;
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  const server = await fetchServer(activeTeam.id, serverId);
  if (!server) notFound();

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Infrastructure · server"
        title={server.name}
        description={
          <span className="inline-flex items-center gap-3">
            <span className="font-mono text-[11px] text-ink-3">{server.hostname}</span>
            <ServerStatusBadge status={server.status} />
          </span>
        }
      />
      <ServerTabsNav serverId={server.id} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
