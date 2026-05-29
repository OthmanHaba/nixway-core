import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/primitives/Logo";

export function DocsHeader() {
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-line-1 bg-surface-0/90 backdrop-blur">
      <div className="h-full max-w-[1240px] mx-auto px-6 sm:px-10 flex items-center justify-between gap-6">
        <Link href="/docs" className="shrink-0 flex items-baseline gap-3">
          <Logo />
          <span className="hidden sm:inline font-mono uppercase tracking-[0.18em] text-[10px] text-ink-3">
            documentation
          </span>
        </Link>

        <Link
          href="/"
          className="group inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-line-1 hover:border-line-2 bg-surface-1 hover:bg-surface-2 px-3 h-8 transition-colors"
        >
          <ArrowLeft className="h-3 w-3 text-ink-3 group-hover:text-signal transition-colors" />
          <span className="font-mono uppercase tracking-[0.14em] text-[10px] text-ink-2 group-hover:text-ink-1">
            Back to site
          </span>
        </Link>
      </div>
    </header>
  );
}
