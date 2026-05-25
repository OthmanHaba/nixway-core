"use client";

import * as React from "react";
import { Label } from "./Label";
import { cn } from "@/lib/cn";

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  trailing?: React.ReactNode;
  className?: string;
  children: React.ReactElement;
}

/**
 * Composed form field — mono-cased label on top, input below, hint or error
 * beneath. Pass exactly one input-like child (Input, etc.).
 */
export function Field({ id, label, hint, error, trailing, className, children }: FieldProps) {
  const child = React.cloneElement(children, {
    id,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
    invalid: !!error,
  } as Record<string, unknown>);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id}>{label}</Label>
        {trailing}
      </div>
      {child}
      {error ? (
        <p id={`${id}-error`} className="font-mono text-[11px] text-alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
