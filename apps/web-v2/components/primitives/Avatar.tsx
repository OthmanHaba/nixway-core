import * as React from "react";
import { cn } from "@/lib/cn";

interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: "sm" | "md" | "lg";
  /** Stable accent based on the source string — useful for member rows. */
  seed?: string;
}

const SIZE: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-10 w-10 text-[13px]",
};

const PALETTE = [
  ["oklch(0.74 0.155 65)",  "oklch(0.20 0.05 60)"],   // signal amber
  ["oklch(0.66 0.13 165)",  "oklch(0.18 0.04 160)"],  // teal
  ["oklch(0.62 0.16 240)",  "oklch(0.16 0.04 250)"],  // blue
  ["oklch(0.68 0.18 300)",  "oklch(0.18 0.05 295)"],  // magenta
  ["oklch(0.75 0.14 130)",  "oklch(0.20 0.04 125)"],  // green
  ["oklch(0.72 0.16 30)",   "oklch(0.20 0.05 25)"],   // coral
] as const;

export function Avatar({ name, size = "md", seed, className, ...rest }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  const [bg, fg] = PALETTE[hash(seed ?? name) % PALETTE.length]!;

  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex items-center justify-center rounded-full font-mono font-medium shrink-0",
        SIZE[size],
        className,
      )}
      style={{ background: bg, color: fg }}
      {...rest}
    >
      {initials || "·"}
    </span>
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
