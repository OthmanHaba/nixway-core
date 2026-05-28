import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Semantic table primitives. The Mission Control table style: hairline rows,
 * uppercase mono header, dense row padding, no zebra. Sorting and selection
 * arrive as a separate layer when first needed.
 */

export function Table({ className, ...rest }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn("w-full text-[13px] border-collapse", className)}
        {...rest}
      />
    </div>
  );
}

export function THead({ className, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("", className)} {...rest} />;
}

export function TBody({ className, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("", className)} {...rest} />;
}

export function TR({ className, ...rest }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-line-1 last:border-b-0 transition-colors",
        "hover:bg-surface-2/60",
        className,
      )}
      {...rest}
    />
  );
}

export function TH({
  className,
  align = "left",
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      align={align}
      className={cn(
        "label-mono py-2.5 px-3 first:pl-4 last:pr-4 font-medium",
        "border-b border-line-1",
        "bg-surface-1/40",
        className,
      )}
      {...rest}
    />
  );
}

export function TD({
  className,
  align = "left",
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      align={align}
      className={cn("py-3 px-3 first:pl-4 last:pr-4 text-ink-1 align-middle", className)}
      {...rest}
    />
  );
}
