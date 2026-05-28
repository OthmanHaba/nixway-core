import { requireUser } from "@/lib/auth";
import { getTeamContext } from "@/lib/team";
import { PageHeader } from "@/components/primitives/PageHeader";
import { SettingsClient } from "@/components/settings/SettingsClient";

export const metadata = { title: "Settings · Nixway Core" };

export default async function SettingsPage() {
  const [user, teamCtx] = await Promise.all([requireUser(), getTeamContext()]);
  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Access · personal"
        title="Settings"
        description="Your profile, appearance, and shortcuts to per-team configuration."
      />
      <div className="reveal reveal-2">
        <SettingsClient user={user} activeTeam={teamCtx.activeTeam} />
      </div>
    </div>
  );
}
