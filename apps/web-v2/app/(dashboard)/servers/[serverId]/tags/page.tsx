import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { tryGet } from "@/lib/server-api";
import { TagsClient } from "@/components/servers/TagsClient";
import type { ServerTag } from "@/lib/types";

export default async function TagsPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  const tags = await tryGet<ServerTag[]>(
    `/teams/${activeTeam.id}/servers/${serverId}/tags`,
    [],
  );

  return <TagsClient teamId={activeTeam.id} serverId={serverId} initialTags={tags} />;
}
