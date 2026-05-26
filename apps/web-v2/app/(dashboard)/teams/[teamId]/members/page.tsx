import { requireUser } from "@/lib/auth";
import { tryGet } from "@/lib/server-api";
import { MembersClient } from "@/components/teams/MembersClient";
import type { TeamInvite, TeamMember } from "@/lib/types";

export const metadata = { title: "Members · Nixway Core" };

export default async function MembersPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const user = await requireUser();

  const [members, invites] = await Promise.all([
    tryGet<TeamMember[]>(`/teams/${teamId}/members`, []),
    tryGet<TeamInvite[]>(`/teams/${teamId}/invites`, []),
  ]);

  return (
    <MembersClient
      teamId={teamId}
      currentUserId={user.id}
      initialMembers={members}
      initialInvites={invites}
    />
  );
}
