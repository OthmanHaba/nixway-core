import { tryGet } from "@/lib/server-api";
import { AuditLogClient } from "@/components/teams/AuditLogClient";
import type { AuditLog } from "@/lib/types";

export const metadata = { title: "Audit Log · Nixway Core" };

export default async function AuditLogPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const entries = await tryGet<AuditLog[]>(`/teams/${teamId}/audit-logs?page_size=50`, []);
  return <AuditLogClient teamId={teamId} initialEntries={entries} />;
}
