import { notFound } from "next/navigation";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { AppSettingsClient } from "@/components/apps/AppSettingsClient";
import type { App, Project } from "@/lib/types";

export default async function AppSettingsPage({
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
  // The registry picker lists team-scoped credentials, so resolve the team via
  // the project. Best-effort: if it fails, the client just hides that control.
  let teamId: string | undefined;
  try {
    const project = await serverApi.get<Project>(`/projects/${app.project_id}`);
    teamId = project.team_id;
  } catch {
    teamId = undefined;
  }
  return <AppSettingsClient app={app} teamId={teamId} />;
}
