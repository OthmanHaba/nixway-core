import * as React from "react";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-dashed border-line-2 bg-surface-1/40",
        "py-14 px-6 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mx-auto mb-4 h-10 w-10 grid place-items-center rounded-full bg-surface-2 text-ink-3">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] text-ink-1 font-medium">{title}</h3>
      {body && (
        <div className="mt-2 text-[12px] text-ink-3 max-w-md mx-auto leading-relaxed">
          {body}
        </div>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
