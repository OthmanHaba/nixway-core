import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface PageHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8",
        className,
      )}
    >
      <div className="space-y-2 min-w-0">
        {eyebrow && <div className="label-mono">{eyebrow}</div>}
        <h1 className="font-display italic text-4xl sm:text-5xl text-ink-1 leading-[1]">
          {title}
        </h1>
        {description && (
          <p className="text-[14px] text-ink-2 max-w-xl leading-relaxed pt-1">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
