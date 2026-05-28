import { notFound } from "next/navigation";
import { serverApi, ServerApiError } from "@/lib/server-api";
import { QueryConsoleClient } from "@/components/databases/QueryConsoleClient";
import type { Database } from "@/lib/types";

export const metadata = { title: "Query · Nixway Core" };

export default async function DatabaseQueryPage({
  params,
}: {
  params: Promise<{ databaseId: string }>;
}) {
  const { databaseId } = await params;

  let database: Database;
  try {
    database = await serverApi.get<Database>(`/databases/${databaseId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }

  const backHref = `/projects/${database.project_id}/databases/${database.id}`;

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1280px] mx-auto">
      <QueryConsoleClient database={database} backHref={backHref} />
    </div>
  );
}
