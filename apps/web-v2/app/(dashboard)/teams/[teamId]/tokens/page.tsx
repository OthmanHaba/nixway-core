import { tryGet } from "@/lib/server-api";
import { TokensClient } from "@/components/teams/TokensClient";
import type { ApiToken } from "@/lib/types";

export const metadata = { title: "API Tokens · Nixway Core" };

export default async function TokensPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const tokens = await tryGet<ApiToken[]>(`/teams/${teamId}/tokens`, []);
  return <TokensClient teamId={teamId} initialTokens={tokens} />;
}
