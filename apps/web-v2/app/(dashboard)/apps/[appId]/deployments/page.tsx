import { notFound } from "next/navigation";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { DeploymentsClient } from "@/components/apps/DeploymentsClient";
import type { App, Deployment, Environment } from "@/lib/types";

export default async function AppDeploymentsPage({
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
  const [deployments, environments] = await Promise.all([
    tryGet<Deployment[]>(`/apps/${appId}/deployments`, []),
    tryGet<Environment[]>(`/projects/${app.project_id}/environments`, []),
  ]);

  return (
    <DeploymentsClient
      appId={appId}
      environments={environments}
      initialDeployments={deployments}
    />
  );
}
