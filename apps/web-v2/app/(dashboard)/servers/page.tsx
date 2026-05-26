import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { tryGet } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import { ServersClient } from "@/components/servers/ServersClient";
import type { Server, SshKey } from "@/lib/types";

export const metadata = { title: "Servers · Nixway Core" };

export default async function ServersPage() {
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  const [servers, sshKeys] = await Promise.all([
    tryGet<Server[]>(`/teams/${activeTeam.id}/servers`, []),
    tryGet<SshKey[]>(`/teams/${activeTeam.id}/ssh-keys`, []),
  ]);

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Infrastructure · fleet"
        title="Servers"
        description="Bare-metal and cloud hosts in this team. Each server runs a Nixway agent that calls home over an outbound tunnel."
      />
      <div className="reveal reveal-2">
        <ServersClient
          teamId={activeTeam.id}
          initialServers={servers}
          sshKeys={sshKeys}
        />
      </div>
    </div>
  );
}
