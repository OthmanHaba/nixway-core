import { redirect } from "next/navigation";

export default async function ClusterIndex({
  params,
}: {
  params: Promise<{ clusterId: string }>;
}) {
  const { clusterId } = await params;
  redirect(`/clusters/${clusterId}/overview`);
}
