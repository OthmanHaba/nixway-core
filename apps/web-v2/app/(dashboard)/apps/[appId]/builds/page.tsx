import { notFound } from "next/navigation";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { BuildsClient } from "@/components/apps/BuildsClient";
import type { App, Build, Environment } from "@/lib/types";

export default async function AppBuildsPage({
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
  const [builds, environments] = await Promise.all([
    tryGet<Build[]>(`/apps/${appId}/builds`, []),
    tryGet<Environment[]>(`/projects/${app.project_id}/environments`, []),
  ]);

  return (
    <BuildsClient appId={appId} environments={environments} initialBuilds={builds} />
  );
}
