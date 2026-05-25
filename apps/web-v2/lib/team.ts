/**
 * Active team resolution for RSC.
 * - The browser sets a `nixway-team` cookie when the operator switches teams.
 * - On every render we fetch the user's teams and pick the cookie team if
 *   it's still valid, otherwise the first team in the list.
 */
import { cookies } from "next/headers";
import { serverApi } from "./server-api";
import { TEAM_COOKIE } from "./team-cookie";
import type { Team } from "./types";

export { TEAM_COOKIE };

export interface TeamContext {
  activeTeam: Team | null;
  teams: Team[];
}

export async function getTeamContext(): Promise<TeamContext> {
  const teams = await safeListTeams();
  if (teams.length === 0) return { activeTeam: null, teams };

  const cookieId = (await cookies()).get(TEAM_COOKIE)?.value;
  const fromCookie = cookieId ? teams.find((t) => t.id === cookieId) : undefined;

  return { activeTeam: fromCookie ?? teams[0], teams };
}

async function safeListTeams(): Promise<Team[]> {
  try {
    return await serverApi.get<Team[]>("/teams");
  } catch {
    return [];
  }
}
