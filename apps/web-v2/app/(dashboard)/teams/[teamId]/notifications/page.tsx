import { tryGet } from "@/lib/server-api";
import { NotificationsClient } from "@/components/notifications/NotificationsClient";
import type {
  AlertEvent,
  AlertRule,
  App,
  Cluster,
  NotificationChannel,
  Project,
  Server,
} from "@/lib/types";

export const metadata = { title: "Notifications · Nixway Core" };

export default async function TeamNotificationsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  const [channels, alerts, events, servers, clusters, projects] = await Promise.all([
    tryGet<NotificationChannel[]>(`/teams/${teamId}/observability/channels`, []),
    tryGet<AlertRule[]>(`/teams/${teamId}/observability/alerts`, []),
    tryGet<AlertEvent[]>(`/teams/${teamId}/observability/events?limit=50`, []),
    tryGet<Server[]>(`/teams/${teamId}/servers`, []),
    tryGet<Cluster[]>(`/teams/${teamId}/clusters`, []),
    tryGet<Project[]>(`/teams/${teamId}/projects`, []),
  ]);

  // Apps live under projects — fan out so the scope picker can list them.
  const appLists = await Promise.all(
    projects.map((p) => tryGet<App[]>(`/projects/${p.id}/apps`, [])),
  );
  const apps = appLists.flat();

  return (
    <NotificationsClient
      teamId={teamId}
      initialChannels={channels}
      initialAlerts={alerts}
      initialEvents={events}
      servers={servers}
      clusters={clusters}
      projects={projects}
      apps={apps}
    />
  );
}
