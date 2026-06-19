import { notFound } from "next/navigation";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { EnvVarsClient } from "@/components/apps/EnvVarsClient";
import type { App, Environment } from "@/lib/types";

export default async function AppVariablesPage({
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

  // Environments are needed for the per-environment scope selector.
  let environments: Environment[] = [];
  try {
    environments = await serverApi.get<Environment[]>(`/projects/${app.project_id}/environments`);
  } catch {
    // Non-fatal: fall back to a production-only default in the client.
  }

  return <EnvVarsClient appId={appId} environments={environments} />;
}
