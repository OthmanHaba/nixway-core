import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team";
import { tryGet } from "@/lib/server-api";
import { PageHeader } from "@/components/primitives/PageHeader";
import { ProjectsClient } from "@/components/projects/ProjectsClient";
import type { Cluster, Project } from "@/lib/types";

export const metadata = { title: "Projects · Nixway Core" };

export default async function ProjectsPage() {
  const { activeTeam } = await getTeamContext();
  if (!activeTeam) redirect("/dashboard");

  const [projects, clusters] = await Promise.all([
    tryGet<Project[]>(`/teams/${activeTeam.id}/projects`, []),
    tryGet<Cluster[]>(`/teams/${activeTeam.id}/clusters`, []),
  ]);

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      <PageHeader
        eyebrow="Workloads · projects"
        title="Projects"
        description="Each project groups apps onto a single cluster, with shared environments and secrets. Pick a project to see and operate its apps."
      />
      <div className="reveal reveal-2">
        <ProjectsClient
          teamId={activeTeam.id}
          initialProjects={projects}
          clusters={clusters}
        />
      </div>
    </div>
  );
}
