"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { CommandPalette } from "./CommandPalette";

interface Props {
  teamId: string | null;
}

/**
 * Topbar trigger + global ⌘K/Ctrl+K listener that owns the CommandPalette dialog
 * state. The Topbar is a server component, so this is the small client island
 * that keeps the shortcut wiring local.
 */
export function CommandTrigger({ teamId }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() !== "k") return;
      // Skip when the user is typing inside a form input — most browsers reserve
      // Cmd+K for search bar focus, and we don't want to hijack textareas either.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        // Allow the shortcut anyway — most palettes do.
      }
      e.preventDefault();
      setOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 h-8 px-3 rounded-[var(--radius-sm)] border border-line-1 bg-surface-0/40 text-ink-3 text-[12px] hover:border-line-2 hover:text-ink-2 transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search resources…</span>
        <span className="ml-auto font-mono text-[10px] tracking-[0.1em] text-ink-4 border border-line-1 rounded px-1.5 py-0.5">
          ⌘ K
        </span>
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} teamId={teamId} />
    </>
  );
}
