"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const button = cva(
  [
    "inline-flex items-center justify-center gap-2 select-none",
    "font-mono uppercase tracking-[0.14em] text-[11px] font-medium",
    "transition-[background,color,border-color,transform,box-shadow] duration-[160ms] ease-[var(--ease-out)]",
    "disabled:opacity-40 disabled:pointer-events-none",
    "focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2",
    "active:translate-y-[0.5px]",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-signal text-[color:var(--signal-ink)]",
          "border border-transparent",
          "shadow-[inset_0_1px_0_color-mix(in_oklch,white_30%,transparent)]",
          "hover:brightness-[1.06]",
        ],
        secondary: [
          "bg-surface-2 text-ink-1 border border-line-1",
          "hover:bg-surface-3 hover:border-line-2",
        ],
        ghost: [
          "bg-transparent text-ink-2 border border-transparent",
          "hover:text-ink-1 hover:bg-surface-2",
        ],
        outline: [
          "bg-transparent text-ink-1 border border-line-2",
          "hover:bg-surface-2",
        ],
        destructive: [
          "bg-alert text-white border border-transparent",
          "hover:brightness-[1.05]",
        ],
        link: [
          "bg-transparent text-signal underline-offset-4",
          "hover:underline px-0",
        ],
      },
      size: {
        sm: "h-8 px-3 text-[10px]",
        md: "h-10 px-4",
        lg: "h-11 px-5 text-[12px]",
        icon: "h-10 w-10 p-0",
      },
      shape: {
        square: "rounded-[var(--radius-sm)]",
        pill: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      shape: "square",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, shape, asChild, loading, disabled, children, ...rest }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(button({ variant, size, shape }), className)}
        disabled={disabled || loading}
        {...rest}
      >
        {loading && (
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-full border border-current border-r-transparent animate-spin"
          />
        )}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";
