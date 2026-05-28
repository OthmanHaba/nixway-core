import { notFound, redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { ServerTerminalClient } from "@/components/servers/ServerTerminalClient";
import type { ServerDetail } from "@/lib/types";

export default async function TerminalPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  let server: ServerDetail;
  try {
    server = await serverApi.get<ServerDetail>(`/teams/${activeTeam.id}/servers/${serverId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }

  return (
    <ServerTerminalClient
      teamId={activeTeam.id}
      serverId={server.id}
      hostname={server.hostname}
      sshUser={server.ssh_user}
      sshPort={server.ssh_port}
      status={server.status}
    />
  );
}
