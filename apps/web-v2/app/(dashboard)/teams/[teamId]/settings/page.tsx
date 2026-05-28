import { notFound } from "next/navigation";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { TeamSettingsClient } from "@/components/teams/TeamSettingsClient";
import type { Team } from "@/lib/types";

export const metadata = { title: "Team Settings · Nixway Core" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  let team: Team;
  try {
    team = await serverApi.get<Team>(`/teams/${teamId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  return <TeamSettingsClient team={team} />;
}
