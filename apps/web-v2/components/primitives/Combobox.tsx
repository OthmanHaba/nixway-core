"use client";

import * as React from "react";
import { Check, ChevronDown, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ComboboxItem {
  value: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
}

interface ComboboxProps {
  value: string | null;
  onChange: (value: string, item: ComboboxItem) => void;
  items: ComboboxItem[];
  /**
   * When provided, the combobox is in "remote" mode: it stops filtering items
   * itself and calls onSearch on every keystroke so the parent can fetch.
   */
  onSearch?: (query: string) => void;
  loading?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}

export function Combobox({
  value,
  onChange,
  items,
  onSearch,
  loading,
  disabled,
  invalid,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const remote = typeof onSearch === "function";

  const visible = React.useMemo(() => {
    if (remote || !query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        it.value.toLowerCase().includes(q) ||
        (it.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query, remote]);

  const selected = items.find((it) => it.value === value) ?? null;

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // Focus the search box and reset active row when opening.
  React.useEffect(() => {
    if (open) {
      setActive(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    setQuery("");
  }, [open]);

  React.useEffect(() => {
    setActive(0);
  }, [visible.length]);

  function commit(item: ComboboxItem) {
    onChange(item.value, item);
    setOpen(false);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = visible[active];
      if (item) commit(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2",
          "h-10 px-3 rounded-[var(--radius-sm)]",
          "bg-surface-1 border border-line-1 text-[13px] text-ink-1",
          "transition-colors outline-none text-left",
          "hover:border-line-2",
          "focus-visible:border-signal focus-visible:shadow-[0_0_0_2px_color-mix(in_oklch,var(--signal)_30%,transparent)]",
          "disabled:opacity-50 disabled:pointer-events-none",
          "aria-[invalid=true]:border-alert",
        )}
      >
        <span className={cn("inline-flex items-center gap-2 min-w-0", !selected && "text-ink-3")}>
          {selected?.icon}
          <span className="truncate">{selected ? selected.label : placeholder}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-3 shrink-0" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-full overflow-hidden",
            "rounded-[var(--radius)] border border-line-1 bg-surface-1 p-1",
            "shadow-[0_8px_24px_-12px_color-mix(in_oklch,black_40%,transparent)]",
          )}
        >
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line-1 mb-1">
            <Search className="h-3.5 w-3.5 text-ink-3 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                onSearch?.(e.target.value);
              }}
              onKeyDown={onInputKeyDown}
              placeholder={searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-[13px] text-ink-1 placeholder:text-ink-3 outline-none"
            />
            {loading && <Loader2 className="h-3.5 w-3.5 text-ink-3 shrink-0 animate-spin" />}
          </div>

          <div role="listbox" className="max-h-[260px] overflow-y-auto">
            {visible.length === 0 ? (
              <div className="px-2.5 py-6 text-center text-[12px] text-ink-3">
                {loading ? "Searching…" : emptyText}
              </div>
            ) : (
              visible.map((it, i) => {
                const isSelected = it.value === value;
                const isActive = i === active;
                return (
                  <button
                    type="button"
                    key={it.value}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => commit(it)}
                    className={cn(
                      "relative flex w-full items-center gap-2 rounded-[var(--radius-sm)]",
                      "py-1.5 pl-8 pr-2.5 text-left outline-none select-none",
                      isActive && "bg-surface-2",
                    )}
                  >
                    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                      {isSelected && <Check className="h-3.5 w-3.5 text-signal" />}
                    </span>
                    {it.icon}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink-1">{it.label}</span>
                      {it.hint && (
                        <span className="block truncate text-[11px] text-ink-3">{it.hint}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
