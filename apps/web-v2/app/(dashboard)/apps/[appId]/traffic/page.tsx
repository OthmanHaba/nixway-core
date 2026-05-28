import { notFound } from "next/navigation";
import { serverApi, ServerApiError, tryGet } from "@/lib/server-api";
import { TrafficClient } from "@/components/apps/TrafficClient";
import type { App, TrafficView } from "@/lib/types";

const EMPTY_VIEW: TrafficView = { route: null, backends: [], events: [] };

export default async function AppTrafficPage({
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

  const view = await tryGet<TrafficView>(`/apps/${appId}/traffic`, EMPTY_VIEW);
  return <TrafficClient app={app} initialView={view} />;
}
