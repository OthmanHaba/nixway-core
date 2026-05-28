import { UserMenu } from "./UserMenu";
import { ThemeToggle } from "./ThemeToggle";
import { CommandTrigger } from "./CommandTrigger";
import type { CurrentUser } from "@/lib/api";

interface TopbarProps {
  user: CurrentUser;
  activeTeamName?: string | null;
  activeTeamId?: string | null;
}

export function Topbar({ user, activeTeamName, activeTeamId }: TopbarProps) {
  return (
    <header className="h-14 shrink-0 border-b border-line-1 bg-surface-1/80 backdrop-blur-sm flex items-center gap-3 px-4 sm:px-6">
      <Breadcrumb team={activeTeamName} />

      <div className="flex-1 hidden md:flex justify-center max-w-md mx-auto w-full">
        <CommandTrigger teamId={activeTeamId ?? null} />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <span className="hidden sm:block w-px h-5 bg-line-1 mx-1" />
        <UserMenu name={user.name || user.email} email={user.email} />
      </div>
    </header>
  );
}

function Breadcrumb({ team }: { team: string | null | undefined }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3"
    >
      {team && (
        <>
          <span className="text-ink-2 truncate max-w-[12rem]">{team}</span>
          <span className="text-ink-4">/</span>
        </>
      )}
      <span className="text-ink-1">Overview</span>
    </nav>
  );
}
