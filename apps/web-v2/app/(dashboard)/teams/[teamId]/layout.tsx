import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import { Badge } from "@/components/primitives/Badge";
import { TeamTabsNav } from "@/components/teams/TeamTabsNav";
import type { Team } from "@/lib/types";

interface Params { teamId: string }

async function fetchTeam(id: string): Promise<Team | null> {
  try {
    return await serverApi.get<Team>(`/teams/${id}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) {
      return null;
    }
    throw err;
  }
}

export default async function TeamDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<Params>;
}) {
  const { teamId } = await params;
  const team = await fetchTeam(teamId);
  if (!team) notFound();

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Access · team"
        title={team.name}
        description={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-[11px] text-ink-3">{team.slug}</span>
            <Badge tone="outline">Active</Badge>
          </span>
        }
      />
      <TeamTabsNav teamId={team.id} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
