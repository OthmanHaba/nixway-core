import { notFound } from "next/navigation";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { AppLogsClient } from "@/components/apps/AppLogsClient";
import type { App, Replica } from "@/lib/types";

export default async function AppLogsPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;
  // Verify the app exists (and we have access) before rendering the client.
  try {
    await serverApi.get<App>(`/apps/${appId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
  const replicas = await tryGet<Replica[]>(`/apps/${appId}/replicas`, []);
  return <AppLogsClient appId={appId} initialReplicas={replicas} />;
}
