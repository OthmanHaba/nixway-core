import { Plus } from "lucide-react";
import { getTeamContext } from "@/lib/team";
import { PageHeader } from "@/components/primitives/PageHeader";
import { Button } from "@/components/primitives/Button";
import { CreateTeamDialog } from "@/components/teams/CreateTeamDialog";
import { TeamsListClient } from "@/components/teams/TeamsListClient";

export const metadata = { title: "Teams · Nixway Core" };

export default async function TeamsPage() {
  const { teams, activeTeam } = await getTeamContext();

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Access · teams"
        title="Teams"
        description="Each team owns its own servers, projects, secrets, and audit log. You can belong to many — switch between them from the sidebar."
        actions={
          teams.length > 0 ? (
            <CreateTeamDialog
              trigger={
                <Button>
                  <Plus className="h-3.5 w-3.5" /> New team
                </Button>
              }
            />
          ) : null
        }
      />
      <div className="reveal reveal-2">
        <TeamsListClient teams={teams} activeTeamId={activeTeam?.id ?? null} />
      </div>
    </div>
  );
}
