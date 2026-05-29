import { Lock, RotateCw } from "lucide-react";

/* Browser-window chrome wrapping the operator console mock. Gives the
   panel a "real product on a real domain" read. URL bar updates per
   scene so the viewer's eye tracks the navigation. */

export function BrowserFrame({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-line-2 bg-surface-1 overflow-hidden shadow-[0_30px_80px_-40px_color-mix(in_oklch,var(--ink-1)_70%,transparent)]"
      style={{
        backgroundImage:
          "linear-gradient(to bottom, color-mix(in oklch, var(--ink-1) 2%, transparent), transparent 6%)",
      }}
    >
      {/* Browser chrome strip */}
      <div className="flex items-center gap-3 h-9 px-3.5 border-b border-line-1 bg-surface-1">
        {/* macOS-style traffic lights */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="h-2.5 w-2.5 rounded-full bg-alert/70 ring-1 ring-inset ring-black/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/70 ring-1 ring-inset ring-black/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-online/70 ring-1 ring-inset ring-black/10" />
        </div>

        {/* URL pill */}
        <div className="flex-1 max-w-md mx-auto">
          <div className="h-6 px-3 rounded-full border border-line-1 bg-surface-2 flex items-center gap-2 text-[10.5px] font-mono text-ink-2">
            <Lock className="h-2.5 w-2.5 text-online shrink-0" />
            <span
              key={url}
              className="demo-url truncate tracking-[0.02em]"
            >
              {url}
            </span>
          </div>
        </div>

        {/* Refresh hint, plus a small "live" indicator so the panel reads
            as an actually-running app, not a static screenshot. */}
        <div className="flex items-center gap-2 shrink-0">
          <RotateCw className="h-3 w-3 text-ink-4" />
          <span className="hidden sm:inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-[0.14em] text-ink-4">
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-online pulse-online" />
            live
          </span>
        </div>
      </div>

      {children}
    </div>
  );
}
