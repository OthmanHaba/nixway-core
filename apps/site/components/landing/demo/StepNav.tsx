"use client";

import { cn } from "@/lib/cn";

interface StepNavProps {
  steps: { id: string; label: string }[];
  active: number;
  onSelect: (i: number) => void;
  /* 0–1 progress through the current step, for the progress underline */
  progress: number;
}

export function StepNav({ steps, active, onSelect, progress }: StepNavProps) {
  return (
    <div className="mt-5">
      {/* Top media-bar: thin signal-amber progress + scene counter */}
      <div className="hidden sm:flex items-center gap-3 mb-2 px-1">
        <span className="font-mono uppercase tracking-[0.18em] text-[9.5px] text-ink-4">
          Scene
        </span>
        <span className="font-mono text-[10px] text-ink-2 num">
          <span className="text-ink-1">
            {String(active + 1).padStart(2, "0")}
          </span>
          <span className="text-ink-4 mx-1">/</span>
          {String(steps.length).padStart(2, "0")}
        </span>
        <span className="flex-1 h-px bg-line-1" />
        <span className="font-mono uppercase tracking-[0.18em] text-[9.5px] text-ink-4">
          {steps[active].label}
        </span>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
        <ul className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-line-1">
          {steps.map((s, i) => {
            const isActive = i === active;
            const isPast = i < active;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  aria-current={isActive ? "step" : undefined}
                  aria-label={`Jump to scene ${i + 1}: ${s.label}`}
                  className={cn(
                    "group relative w-full text-left px-3 py-3 sm:py-3.5 overflow-hidden",
                    "transition-[background-color,color] duration-200",
                    "focus-visible:outline-none focus-visible:bg-surface-2",
                    isActive ? "bg-surface-2" : "hover:bg-surface-2 active:bg-surface-3",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-4 w-4 rounded-full grid place-items-center font-mono text-[9px] shrink-0",
                        "transition-[background-color,color,box-shadow] duration-300",
                        isActive
                          ? "bg-signal text-[color:var(--signal-ink)] shadow-[0_0_0_4px_color-mix(in_oklch,var(--signal)_18%,transparent)]"
                          : isPast
                            ? "bg-[color-mix(in_oklch,var(--online)_22%,transparent)] text-online"
                            : "bg-surface-3 text-ink-4",
                      )}
                    >
                      {isPast ? "✓" : i + 1}
                    </span>
                    <span
                      className={cn(
                        "font-mono uppercase tracking-[0.14em] text-[9.5px] truncate",
                        isActive ? "text-ink-1" : "text-ink-3 group-hover:text-ink-2",
                      )}
                    >
                      {s.label}
                    </span>
                  </div>

                  {/* Progress underline for the active step (signal amber) */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-0 bottom-0 h-[2px] bg-signal",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                    style={{
                      width: `${isActive ? progress * 100 : 0}%`,
                      boxShadow: isActive
                        ? "0 -1px 6px color-mix(in oklch, var(--signal) 50%, transparent)"
                        : "none",
                    }}
                  />

                  {/* Past-step fill: subtle online-green at the bottom */}
                  {isPast && (
                    <span
                      aria-hidden
                      className="absolute left-0 bottom-0 h-[2px] w-full bg-online/40"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
