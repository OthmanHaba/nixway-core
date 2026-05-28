import { notFound, redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { ServerProvisioningClient } from "@/components/servers/ServerProvisioningClient";
import type { ProvisioningJob, ServerDetail } from "@/lib/types";

export default async function ProvisioningPage({
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

  // Fresh servers have no provisioning history — handler responds 404 and we
  // hand the client a null job to render the first-run picker.
  let job: ProvisioningJob | null = null;
  try {
    job = await serverApi.get<ProvisioningJob>(
      `/teams/${activeTeam.id}/servers/${serverId}/provision`,
    );
  } catch (err) {
    if (!(err instanceof ServerApiError && err.status === 404)) throw err;
  }

  return (
    <ServerProvisioningClient
      teamId={activeTeam.id}
      server={server}
      initialJob={job}
    />
  );
}
