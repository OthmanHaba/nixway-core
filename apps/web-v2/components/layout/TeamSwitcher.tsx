"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/primitives/DropdownMenu";
import { CreateTeamDialog } from "@/components/teams/CreateTeamDialog";
import { cn } from "@/lib/cn";
import { TEAM_COOKIE } from "@/lib/team-cookie";
import type { Team } from "@/lib/types";

interface TeamSwitcherProps {
  teams: Team[];
  activeTeam: Team | null;
}

export function TeamSwitcher({ teams, activeTeam }: TeamSwitcherProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(teamId: string) {
    if (teamId === activeTeam?.id) return;
    document.cookie = `${TEAM_COOKIE}=${teamId}; path=/; max-age=31536000; SameSite=Lax`;
    startTransition(() => router.refresh());
  }

  if (!activeTeam) {
    return (
      <CreateTeamDialog
        trigger={
          <button
            type="button"
            className="w-full flex items-center gap-2.5 h-9 px-2 rounded-[var(--radius-sm)] border border-dashed border-line-2 text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="text-[12px]">Create your first team</span>
          </button>
        }
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className={cn(
            "w-full flex items-center gap-2 h-9 px-2 rounded-[var(--radius-sm)]",
            "hover:bg-surface-2 transition-colors",
            "disabled:opacity-60",
          )}
        >
          <span className="h-5 w-5 shrink-0 rounded-[3px] bg-signal text-[color:var(--signal-ink)] grid place-items-center font-mono text-[10px] font-medium">
            {initial(activeTeam.name)}
          </span>
          <span className="flex-1 min-w-0 text-left">
            <span className="block text-[12px] text-ink-1 truncate">{activeTeam.name}</span>
            <span className="block font-mono text-[10px] text-ink-3 truncate">
              {activeTeam.slug}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-ink-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={6} className="w-[212px]">
        <DropdownMenuLabel>Teams · {teams.length}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {teams.map((team) => (
          <DropdownMenuItem
            key={team.id}
            onSelect={() => switchTo(team.id)}
            className="justify-between"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="h-5 w-5 shrink-0 rounded-[3px] bg-surface-3 text-ink-2 grid place-items-center font-mono text-[10px] font-medium">
                {initial(team.name)}
              </span>
              <span className="truncate">{team.name}</span>
            </span>
            {team.id === activeTeam.id && (
              <Check className="h-3.5 w-3.5 text-signal shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <CreateTeamDialog
          trigger={
            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
              <Plus className="h-3.5 w-3.5" />
              Create team
            </DropdownMenuItem>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initial(name: string): string {
  const t = name.trim();
  if (!t) return "·";
  return t[0].toUpperCase();
}
