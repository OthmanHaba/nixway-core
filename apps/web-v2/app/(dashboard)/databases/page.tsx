import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { tryGet } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import {
  TopDatabasesClient,
  type DatabaseWithProject,
} from "@/components/databases/TopDatabasesClient";
import type { Database, Project } from "@/lib/types";

export const metadata = { title: "Databases · Nixway Core" };

export default async function TopDatabasesPage() {
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  const projects = await tryGet<Project[]>(`/teams/${activeTeam.id}/projects`, []);

  // Fan out across projects in parallel — there's no team-wide DB list endpoint.
  // Each lookup is tryGet so a single bad project doesn't kill the page.
  const grouped = await Promise.all(
    projects.map(async (p) => {
      const dbs = await tryGet<Database[]>(`/projects/${p.id}/databases`, []);
      return dbs.map<DatabaseWithProject>((d) => ({
        ...d,
        project_name: p.name,
        project_slug: p.slug,
      }));
    }),
  );
  const rows = grouped.flat();

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Workloads · stateful"
        title="Databases"
        description="Every managed database across this team's projects. Open a row to manage replicas, links, backups, and rotations."
      />
      <div className="reveal reveal-2">
        <TopDatabasesClient rows={rows} />
      </div>
    </div>
  );
}
