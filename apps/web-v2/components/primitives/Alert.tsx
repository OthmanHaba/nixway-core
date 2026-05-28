import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "info" | "success" | "warn" | "error";

const ICON: Record<Tone, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
};

const TONE: Record<Tone, string> = {
  info:    "border-l-info text-ink-1",
  success: "border-l-online text-ink-1",
  warn:    "border-l-warn text-ink-1",
  error:   "border-l-alert text-ink-1",
};

const ICON_TONE: Record<Tone, string> = {
  info:    "text-info",
  success: "text-online",
  warn:    "text-warn",
  error:   "text-alert",
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  title?: string;
}

export function Alert({ tone = "info", title, className, children, ...rest }: AlertProps) {
  const Icon = ICON[tone];
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-3 border-l-2 bg-surface-2/60 px-3 py-2.5 rounded-r-[var(--radius-sm)]",
        TONE[tone],
        className,
      )}
      {...rest}
    >
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", ICON_TONE[tone])} />
      <div className="text-[13px] leading-relaxed">
        {title && <div className="font-medium mb-0.5">{title}</div>}
        <div className="text-ink-2">{children}</div>
      </div>
    </div>
  );
}
