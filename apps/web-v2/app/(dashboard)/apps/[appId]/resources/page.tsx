import { notFound } from "next/navigation";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { ResourcesForm } from "@/components/apps/ResourcesForm";
import type { App } from "@/lib/types";

export default async function AppResourcesPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;
  let app: App;
  try {
    app = await serverApi.get<App>(`/apps/${appId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
  return <ResourcesForm app={app} />;
}
