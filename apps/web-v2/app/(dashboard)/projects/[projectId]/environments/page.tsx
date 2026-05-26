import { tryGet } from "@/lib/server-api";
import { EnvironmentsClient } from "@/components/projects/EnvironmentsClient";
import type { Environment } from "@/lib/types";

export default async function ProjectEnvironmentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const environments = await tryGet<Environment[]>(`/projects/${projectId}/environments`, []);
  return <EnvironmentsClient projectId={projectId} initialEnvironments={environments} />;
}
