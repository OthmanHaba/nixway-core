import { tryGet } from "@/lib/server-api";
import { SecretsClient } from "@/components/teams/SecretsClient";
import type { Secret } from "@/lib/types";

export const metadata = { title: "Secrets · Nixway Core" };

export default async function SecretsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const secrets = await tryGet<Secret[]>(`/teams/${teamId}/secrets`, []);
  return <SecretsClient teamId={teamId} initialSecrets={secrets} />;
}
