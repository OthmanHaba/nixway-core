"use client";

import { useEffect, useRef, useState } from "react";
import {
  CircleDot,
  TriangleAlert,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { databasesApi } from "@/lib/api";
import type { ProvisionLogEntry } from "@/lib/types";

interface Props {
  projectId: string;
  databaseId: string;
  /** Persisted events already on the row when the user opened the console. */
  initialEvents?: ProvisionLogEntry[];
  /** Caller is told once a terminal event arrives so it can flip UI state. */
  onTerminal?: (success: boolean) => void;
  /** Suppress the SSE subscription — useful when re-rendering for a completed run. */
  live?: boolean;
}

type Status = "connecting" | "streaming" | "success" | "failed" | "idle";

/**
 * Tails the database provision SSE stream and renders each event in a
 * terminal-style log. Merges with any pre-existing persisted entries so the
 * detail page can show full history even after the live channel has closed.
 */
export function ProvisionConsole({
  projectId,
  databaseId,
  initialEvents = [],
  onTerminal,
  live = true,
}: Props) {
  const [events, setEvents] = useState<ProvisionLogEntry[]>(initialEvents);
  const [status, setStatus] = useState<Status>(
    // If the persisted log already contains a terminal event, we're done —
    // no need to open SSE just to receive a closed channel.
    () => initialStatus(initialEvents, live),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keep onTerminal in a ref so we don't tear down the SSE every time the
  // caller re-renders with a fresh closure identity.
  const onTerminalRef = useLatest(onTerminal);

  useEffect(() => {
    // If a terminal entry already lives in `initialEvents`, skip SSE.
    if (!live || initialStatus(initialEvents, live) !== "connecting") return;

    const url = databasesApi.provisionStreamUrl(projectId, databaseId);
    const es = new EventSource(url, { withCredentials: true });

    es.onopen = () => setStatus((s) => (s === "connecting" ? "streaming" : s));
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as ProvisionLogEntry;
        // Backend stamps `at` on the persisted copy but the live event may
        // arrive without it; fall back to client time so the UI stays sorted.
        if (!evt.at) evt.at = new Date().toISOString();
        setEvents((prev) => {
          // Dedupe — if the persisted log already covered this event (e.g. on
          // page refresh mid-stream), skip the duplicate.
          if (prev.some((p) => p.at === evt.at && p.step === evt.step && p.message === evt.message)) {
            return prev;
          }
          return [...prev, evt];
        });
        if (evt.terminal) {
          setStatus(evt.success ? "success" : "failed");
          onTerminalRef.current?.(!!evt.success);
          es.close();
        }
      } catch {
        // Ignore unparseable frames.
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects unless we close it. We only close on
      // terminal — keep retrying on transient network blips.
      setStatus((s) => (s === "streaming" ? "connecting" : s));
    };

    return () => es.close();
    // initialEvents is only read once at mount-time to decide whether to
    // open SSE; ignoring it as a dep is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, databaseId, live]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="space-y-2">
      <header className="flex items-center justify-between gap-3">
        <div className="label-mono inline-flex items-center gap-2">
          <CircleDot className="h-3 w-3" />
          Provision log
        </div>
        <StatusPill status={status} count={events.length} />
      </header>

      <div
        ref={scrollRef}
        className="h-72 overflow-auto rounded-[var(--radius-md)] border border-line-1 bg-[#0a0d10] p-3 font-mono text-[11px] leading-5"
      >
        {events.length === 0 ? (
          <p className="text-ink-4">
            {status === "connecting"
              ? "Connecting to provisioning stream…"
              : "No events yet."}
          </p>
        ) : (
          events.map((evt, i) => <LogLine key={`${evt.at}-${i}`} evt={evt} />)
        )}
      </div>
    </div>
  );
}

function LogLine({ evt }: { evt: ProvisionLogEntry }) {
  const stepClass =
    evt.level === "error"
      ? "text-alert"
      : evt.level === "warn"
        ? "text-warn"
        : "text-online";
  return (
    <div className="flex gap-2 whitespace-pre-wrap break-words">
      <span className="text-ink-4 num shrink-0">{formatStamp(evt.at)}</span>
      <span className={`${stepClass} shrink-0`}>[{evt.step}]</span>
      <span className="text-ink-1">{evt.message}</span>
    </div>
  );
}

function StatusPill({ status, count }: { status: Status; count: number }) {
  const map: Record<
    Status,
    { label: string; icon: React.ReactNode; klass: string }
  > = {
    connecting: {
      label: "Connecting",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      klass: "text-ink-3 border-line-1 bg-surface-2",
    },
    streaming: {
      label: "Streaming",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      klass: "text-signal border-signal/40 bg-[color:var(--signal-soft)]/30",
    },
    success: {
      label: "Completed",
      icon: <CheckCircle2 className="h-3 w-3" />,
      klass: "text-online border-online/40 bg-online/10",
    },
    failed: {
      label: "Failed",
      icon: <XCircle className="h-3 w-3" />,
      klass: "text-alert border-alert/40 bg-alert/10",
    },
    idle: {
      label: "Idle",
      icon: <TriangleAlert className="h-3 w-3" />,
      klass: "text-ink-3 border-line-1 bg-surface-2",
    },
  };
  const { label, icon, klass } = map[status];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 " +
        "font-mono text-[10px] uppercase tracking-[0.14em] num " +
        klass
      }
    >
      {icon}
      {label}
      <span className="text-ink-4">· {count}</span>
    </span>
  );
}

/** Keeps the latest value of a non-stable prop accessible from a stable ref. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function initialStatus(events: ProvisionLogEntry[], live: boolean): Status {
  const terminal = events.find((e) => e.terminal);
  if (terminal) return terminal.success ? "success" : "failed";
  return live ? "connecting" : "idle";
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  // HH:MM:SS, monospace-aligned.
  return d.toTimeString().slice(0, 8);
}
