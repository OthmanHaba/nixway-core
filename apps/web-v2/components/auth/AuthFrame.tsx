import type { ReactNode } from "react";
import { StatusPanel } from "./StatusPanel";
import { Logo } from "@/components/layout/Logo";

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grain min-h-dvh bg-surface-0 grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      {/* ── form column ─────────────────────────────────────────────── */}
      <section className="relative flex flex-col px-6 sm:px-10 lg:px-16 py-8 lg:py-10">
        <header className="flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="hidden sm:inline-block h-3 w-px bg-line-2" />
            <span className="hidden sm:inline-block font-mono uppercase tracking-[0.14em] text-ink-3">
              v0.4.0 · console
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono uppercase tracking-[0.14em] text-ink-3 text-[10px]">
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-online">
              <span className="pulse-online absolute inset-0 rounded-full" />
            </span>
            <span>All systems nominal</span>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center py-12">
          <div className="w-full max-w-[440px]">{children}</div>
        </div>

        <footer className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.14em] text-ink-4">
          <span>© Nixway Systems</span>
          <span className="flex items-center gap-4">
            <a href="#" className="hover:text-ink-2 transition-colors">Status</a>
            <a href="#" className="hover:text-ink-2 transition-colors">Docs</a>
            <a href="#" className="hover:text-ink-2 transition-colors">Privacy</a>
          </span>
        </footer>
      </section>

      {/* ── decorative status panel (lg+) ───────────────────────────── */}
      <aside className="hidden lg:block relative border-l border-line-1 bg-surface-1 overflow-hidden">
        <StatusPanel />
      </aside>
    </div>
  );
}
