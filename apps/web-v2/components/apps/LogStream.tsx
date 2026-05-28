"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, X } from "lucide-react";
import { Badge } from "@/components/primitives/Badge";
import { cn } from "@/lib/cn";

interface LogStreamProps {
  /** Absolute path to the SSE log endpoint (e.g. /api/v1/apps/{id}/builds/{id}/logs). */
  url: string;
  /** Optional title shown at the top of the panel. */
  title?: string;
  onClose?: () => void;
  /** Case-insensitive substring; non-matching lines are hidden from display. */
  filter?: string;
  /** Optional override for the panel's max height. */
  className?: string;
}

/**
 * Lightweight SSE log viewer. Connects on mount, renders incoming lines into a
 * scrolling monospace pre, and shows a Live badge while the connection is open.
 */
export function LogStream({ url, title, onClose, filter, className }: LogStreamProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const needle = filter?.trim().toLowerCase() ?? "";
  const visible = needle
    ? lines.filter((l) => l.toLowerCase().includes(needle))
    : lines;

  useEffect(() => {
    setLines([]);
    setError(null);
    const es = new EventSource(url, { withCredentials: true });

    es.onopen = () => setLive(true);
    es.onmessage = (e) => {
      setLines((prev) => {
        const next = [...prev, e.data];
        // Cap buffer at 5000 lines to keep memory steady on long streams.
        if (next.length > 5000) next.splice(0, next.length - 5000);
        return next;
      });
    };
    es.onerror = () => {
      setLive(false);
      // Browser may close + reconnect on its own; the readyState tells us.
      if (es.readyState === EventSource.CLOSED) {
        setError("Stream closed.");
        es.close();
      }
    };

    return () => {
      es.close();
      setLive(false);
    };
  }, [url]);

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      className={cn(
        "flex flex-col rounded-[var(--radius-lg)] border border-line-1 bg-[#0c0d12] overflow-hidden",
        className ?? "h-[min(560px,calc(100dvh-220px))]",
      )}
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-line-1 bg-surface-1/40">
        <div className="flex items-center gap-3 min-w-0">
          <div className="label-mono flex items-center gap-2 text-ink-2">
            <Activity className="h-3 w-3" />
            {title ?? "Logs"}
          </div>
          {live ? (
            <Badge tone="online" dot>Live</Badge>
          ) : (
            <Badge tone="neutral">Idle</Badge>
          )}
          <span className="font-mono text-[10px] text-ink-4 num">
            {needle ? `${visible.length} / ${lines.length}` : `${lines.length} ${lines.length === 1 ? "line" : "lines"}`}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
            aria-label="Close logs"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </header>
      <pre
        ref={preRef}
        className={cn(
          "flex-1 overflow-auto p-3",
          "font-mono text-[12px] leading-[1.55] whitespace-pre-wrap break-all",
          "text-[#cbd2e0]",
        )}
      >
        {lines.length === 0 && !error ? (
          <span className="text-ink-3">Waiting for output…</span>
        ) : visible.length === 0 ? (
          <span className="text-ink-3">No lines match the filter yet.</span>
        ) : (
          visible.map((line, i) => (
            <div key={i}>{line}</div>
          ))
        )}
        {error && <div className="text-alert mt-2">— {error}</div>}
      </pre>
    </div>
  );
}
