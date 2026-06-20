import { requireUser } from "@/lib/auth";
import { getTeamContext } from "@/lib/team";
import { PageHeader } from "@/components/primitives/PageHeader";
import { IntegrationsClient } from "@/components/integrations/IntegrationsClient";

export const metadata = { title: "Integrations · Nixway Core" };

export default async function IntegrationsPage() {
  const [, teamCtx] = await Promise.all([requireUser(), getTeamContext()]);
  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Access · integrations"
        title="Integrations"
        description="Connect a GitHub App for private-repo deploys and manage container-registry credentials."
      />
      <div className="reveal reveal-2">
        <IntegrationsClient activeTeam={teamCtx.activeTeam} />
      </div>
    </div>
  );
}
