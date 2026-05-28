import { notFound } from "next/navigation";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { AutoscaleClient } from "@/components/apps/AutoscaleClient";
import type { App, AutoscalingRule } from "@/lib/types";

export default async function AppAutoscalingPage({
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

  const rules = await tryGet<AutoscalingRule[]>(`/apps/${appId}/autoscaling-rules`, []);
  return <AutoscaleClient app={app} initialRules={rules} />;
}
