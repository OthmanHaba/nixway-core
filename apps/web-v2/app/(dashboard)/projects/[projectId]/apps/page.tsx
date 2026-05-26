import { tryGet } from "@/lib/server-api";
import { AppsListClient } from "@/components/projects/AppsListClient";
import type { App } from "@/lib/types";

export default async function ProjectAppsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const apps = await tryGet<App[]>(`/projects/${projectId}/apps`, []);
  return <AppsListClient projectId={projectId} initialApps={apps} />;
}
