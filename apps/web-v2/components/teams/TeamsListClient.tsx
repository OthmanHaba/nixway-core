"use client";

import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Badge } from "@/components/primitives/Badge";
import { EmptyState } from "@/components/primitives/EmptyState";
import { CreateTeamDialog } from "./CreateTeamDialog";
import type { Team } from "@/lib/types";

export function TeamsListClient({
  teams,
  activeTeamId,
}: {
  teams: Team[];
  activeTeamId?: string | null;
}) {
  if (teams.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-4 w-4" />}
        title="No teams yet"
        body="Create your first team to start registering servers, provisioning databases, and inviting operators."
        action={
          <CreateTeamDialog
            trigger={
              <Button>
                <Plus className="h-3.5 w-3.5" /> Create team
              </Button>
            }
          />
        }
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {teams.map((team) => {
        const isActive = team.id === activeTeamId;
        return (
          <li key={team.id}>
            <Link
              href={`/teams/${team.id}/members`}
              className="group block rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 p-5 hover:border-line-2 hover:bg-surface-2 transition-colors h-full"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <div className="text-[15px] text-ink-1 truncate font-medium">{team.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-ink-3 truncate">{team.slug}</div>
                </div>
                {isActive && <Badge tone="signal" dot>Active</Badge>}
              </div>
              <dl className="space-y-2 text-[12px]">
                <Row label="Created"><time>{formatDate(team.created_at)}</time></Row>
                <Row label="Updated"><time>{formatDate(team.updated_at)}</time></Row>
              </dl>
              <div className="mt-5 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.14em] text-ink-3 group-hover:text-signal transition-colors">
                Manage members →
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="label-mono">{label}</dt>
      <dd className="font-mono text-[11px] text-ink-2 num">{children}</dd>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
