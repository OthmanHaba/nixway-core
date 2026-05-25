import { Search } from "lucide-react";
import { UserMenu } from "./UserMenu";
import { ThemeToggle } from "./ThemeToggle";
import type { CurrentUser } from "@/lib/api";

interface TopbarProps {
  user: CurrentUser;
  activeTeamName?: string | null;
}

export function Topbar({ user, activeTeamName }: TopbarProps) {
  return (
    <header className="h-14 shrink-0 border-b border-line-1 bg-surface-1/80 backdrop-blur-sm flex items-center gap-3 px-4 sm:px-6">
      <Breadcrumb team={activeTeamName} />

      <div className="flex-1 hidden md:flex justify-center max-w-md mx-auto w-full">
        <CommandHint />
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

function CommandHint() {
  return (
    <button
      type="button"
      className="w-full flex items-center gap-2 h-8 px-3 rounded-[var(--radius-sm)] border border-line-1 bg-surface-0/40 text-ink-3 text-[12px] hover:border-line-2 hover:text-ink-2 transition-colors"
    >
      <Search className="h-3.5 w-3.5" />
      <span>Search resources…</span>
      <span className="ml-auto font-mono text-[10px] tracking-[0.1em] text-ink-4 border border-line-1 rounded px-1.5 py-0.5">
        ⌘ K
      </span>
    </button>
  );
}
