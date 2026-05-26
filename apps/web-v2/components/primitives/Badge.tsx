import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badge = cva(
  [
    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[3px]",
    "font-mono uppercase tracking-[0.14em] text-[10px] font-medium",
    "border",
  ],
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-ink-2 border-line-1",
        signal:  "bg-[color:var(--signal-soft)] text-[color:var(--signal-ink)] border-transparent",
        online:  "bg-[color-mix(in_oklch,var(--online)_18%,transparent)] text-[color:var(--online)] border-[color-mix(in_oklch,var(--online)_30%,transparent)]",
        warn:    "bg-[color-mix(in_oklch,var(--warn)_18%,transparent)] text-[color:var(--warn)] border-[color-mix(in_oklch,var(--warn)_30%,transparent)]",
        alert:   "bg-[color-mix(in_oklch,var(--alert)_18%,transparent)] text-[color:var(--alert)] border-[color-mix(in_oklch,var(--alert)_30%,transparent)]",
        info:    "bg-[color-mix(in_oklch,var(--info)_18%,transparent)] text-[color:var(--info)] border-[color-mix(in_oklch,var(--info)_30%,transparent)]",
        outline: "bg-transparent text-ink-2 border-line-2",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badge> {
  dot?: boolean;
}

export function Badge({ tone, className, dot, children, ...rest }: BadgeProps) {
  return (
    <span className={cn(badge({ tone }), className)} {...rest}>
      {dot && <span className="h-1 w-1 rounded-full bg-current" />}
      {children}
    </span>
  );
}
