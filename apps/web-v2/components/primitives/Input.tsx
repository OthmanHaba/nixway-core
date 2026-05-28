"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/**
 * Underline-style input: no boxed appearance — just a baseline that lights up.
 * The dense, refined feel of an operator console.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, type = "text", ...rest }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        aria-invalid={invalid || undefined}
        className={cn(
          "peer w-full bg-transparent px-0 py-2.5",
          "text-[15px] text-ink-1 placeholder:text-ink-4",
          "border-0 border-b border-line-2",
          "outline-none transition-[border-color,box-shadow] duration-[160ms] ease-[var(--ease-out)]",
          "hover:border-ink-3",
          "focus:border-signal focus:shadow-[0_1px_0_0_var(--signal)]",
          "disabled:opacity-50",
          "aria-[invalid=true]:border-alert aria-[invalid=true]:shadow-[0_1px_0_0_var(--alert)]",
          "autofill:bg-transparent",
          className,
        )}
        {...rest}
      />
    );
  },
);
Input.displayName = "Input";
