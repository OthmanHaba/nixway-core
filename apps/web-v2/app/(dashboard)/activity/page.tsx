import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { tryGet } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import { AuditLogClient } from "@/components/teams/AuditLogClient";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Activity as ActivityIcon } from "lucide-react";
import type { AuditLog } from "@/lib/types";

export const metadata = { title: "Activity · Nixway Core" };

export default async function ActivityPage() {
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  const entries = await tryGet<AuditLog[]>(
    `/teams/${activeTeam.id}/audit-logs?page_size=50`,
    [],
  );

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Control · feed"
        title="Activity"
        description={
          <>
            Everything that happens in <span className="text-ink-1">{activeTeam.name}</span>{" "}
            — server onboardings, deploys, scale events, secret rotations and access changes.
            Sourced from the team audit log.
          </>
        }
      />
      <div className="reveal reveal-2">
        {entries.length === 0 ? (
          <EmptyState
            icon={<ActivityIcon className="h-4 w-4" />}
            title="No activity yet"
            body="Once team members start onboarding servers, deploying apps or rotating credentials, those events will stream in here."
          />
        ) : (
          <AuditLogClient teamId={activeTeam.id} initialEntries={entries} />
        )}
      </div>
    </div>
  );
}
