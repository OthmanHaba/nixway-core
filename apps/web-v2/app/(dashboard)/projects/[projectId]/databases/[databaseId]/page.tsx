import { notFound, redirect } from "next/navigation";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { getTeamContext } from "@/lib/team";
import { DatabaseDetailClient } from "@/components/databases/DatabaseDetailClient";
import type {
  App,
  Database,
  DatabaseCredentialRotation,
  DatabaseLink,
} from "@/lib/types";

export default async function ProjectDatabaseDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; databaseId: string }>;
}) {
  const { projectId, databaseId } = await params;
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  let database: Database;
  try {
    database = await serverApi.get<Database>(
      `/projects/${projectId}/databases/${databaseId}`,
    );
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }

  const [links, rotations, apps] = await Promise.all([
    tryGet<DatabaseLink[]>(`/projects/${projectId}/databases/${databaseId}/links`, []),
    tryGet<DatabaseCredentialRotation[]>(
      `/projects/${projectId}/databases/${databaseId}/rotations`,
      [],
    ),
    tryGet<App[]>(`/projects/${projectId}/apps`, []),
  ]);

  return (
    <DatabaseDetailClient
      projectId={projectId}
      initialDatabase={database}
      initialLinks={links}
      initialRotations={rotations}
      projectApps={apps}
    />
  );
}
