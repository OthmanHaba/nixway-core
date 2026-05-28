import { redirect } from "next/navigation";

export default async function ServerDetailIndex({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  redirect(`/servers/${serverId}/overview`);
}
