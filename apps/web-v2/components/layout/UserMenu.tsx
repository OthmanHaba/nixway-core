"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown, LogOut, Settings, User as UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/primitives/DropdownMenu";
import { authApi } from "@/lib/api";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function signOut() {
    startTransition(async () => {
      try { await authApi.logout(); } catch { /* ignore */ }
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 pl-1 pr-2 h-9 rounded-[var(--radius-sm)] hover:bg-surface-2 transition-colors"
        >
          <span className="h-7 w-7 rounded-full bg-signal text-[color:var(--signal-ink)] grid place-items-center font-mono text-[11px] font-medium">
            {initials || "·"}
          </span>
          <span className="hidden sm:flex flex-col items-start leading-tight">
            <span className="text-[12px] text-ink-1">{name}</span>
            <span className="font-mono text-[10px] text-ink-3">{email}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Signed in</DropdownMenuLabel>
        <div className="px-2.5 pb-2 text-[12px]">
          <div className="text-ink-1">{name}</div>
          <div className="font-mono text-[11px] text-ink-3 truncate">{email}</div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <UserIcon className="h-3.5 w-3.5 text-ink-3" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Settings className="h-3.5 w-3.5 text-ink-3" />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} disabled={pending}>
          <LogOut className="h-3.5 w-3.5 text-alert" />
          <span className="text-alert">Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
