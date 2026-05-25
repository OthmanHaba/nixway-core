import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { getTeamContext } from "@/lib/team";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const [user, teamCtx] = await Promise.all([requireUser(), getTeamContext()]);
  return (
    <div className="min-h-dvh flex bg-surface-0">
      <Sidebar teams={teamCtx.teams} activeTeam={teamCtx.activeTeam} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={user} activeTeamName={teamCtx.activeTeam?.name ?? null} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
