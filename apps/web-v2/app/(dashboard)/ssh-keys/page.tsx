import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { tryGet } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import { SshKeysClient } from "@/components/ssh-keys/SshKeysClient";
import type { SshKey } from "@/lib/types";

export const metadata = { title: "SSH Keys · Nixway Core" };

export default async function SshKeysPage() {
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  const keys = await tryGet<SshKey[]>(`/teams/${activeTeam.id}/ssh-keys`, []);

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Access · ssh"
        title="SSH Keys"
        description="Keypairs used to onboard new servers over SSH. The platform encrypts private keys at rest and only reveals them once at creation."
      />
      <div className="reveal reveal-2">
        <SshKeysClient teamId={activeTeam.id} initialKeys={keys} />
      </div>
    </div>
  );
}
