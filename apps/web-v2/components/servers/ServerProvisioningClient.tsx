"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleDot,
  Loader2,
  Package,
  Play,
  RefreshCw,
  RotateCw,
  ScrollText,
  TriangleAlert,
  XCircle,
  Zap,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Alert } from "@/components/primitives/Alert";
import { EmptyState } from "@/components/primitives/EmptyState";
import { serverProvisionApi, ApiError } from "@/lib/api";
import {
  PROVISIONING_COMPONENTS,
  type ProvisioningComponent,
  type ProvisioningJob,
  type ServerDetail,
} from "@/lib/types";

interface Props {
  teamId: string;
  server: ServerDetail;
  initialJob: ProvisioningJob | null;
}

export function ServerProvisioningClient({
  teamId,
  server,
  initialJob,
}: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const jobQ = useQuery({
    queryKey: ["server-provisioning-job", server.id],
    queryFn: async () => {
      try {
        return await serverProvisionApi.status(teamId, server.id);
      } catch (err) {
        // First-time servers have no job; surface that as null so the picker
        // is the default view.
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    initialData: initialJob,
    // Tight cadence while a run is in flight so status flips reach the UI fast.
    refetchInterval: (q) =>
      q.state.data?.status === "running" || q.state.data?.status === "pending"
        ? 3_000
        : 30_000,
  });
  const job = jobQ.data ?? null;
  const isRunning = job?.status === "running" || job?.status === "pending";

  // Default-checked components: when no prior run exists, pre-select all (so a
  // first-time provision installs the full stack); on subsequent runs, default
  // to whatever the latest job ran with so re-runs reuse the same set.
  const initialSelection = useMemo<ProvisioningComponent[]>(() => {
    if (!initialJob) return PROVISIONING_COMPONENTS.map((c) => c.id);
    return initialJob.components;
  }, [initialJob]);
  const [selected, setSelected] = useState<ProvisioningComponent[]>(initialSelection);

  function toggle(c: ProvisioningComponent) {
    setSelected((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  const start = useMutation({
    mutationFn: (components: ProvisioningComponent[]) =>
      serverProvisionApi.start(teamId, server.id, components),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({
        queryKey: ["server-provisioning-job", server.id],
      });
    },
    onError: (err) =>
      setError(
        err instanceof ApiError ? err.message : "Could not start provisioning.",
      ),
  });

  const retry = useMutation({
    mutationFn: () => serverProvisionApi.retry(teamId, server.id),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({
        queryKey: ["server-provisioning-job", server.id],
      });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not retry."),
  });

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}

      <LatestRunCard
        teamId={teamId}
        serverId={server.id}
        job={job}
        isRunning={isRunning}
        onRetry={() => retry.mutate()}
        retryPending={retry.isPending}
        onUpdateAgent={() => start.mutate(["agent"])}
        agentPending={
          start.isPending &&
          start.variables?.length === 1 &&
          start.variables[0] === "agent"
        }
      />

      <ComponentPickerCard
        selected={selected}
        onToggle={toggle}
        onSelectAll={() =>
          setSelected(PROVISIONING_COMPONENTS.map((c) => c.id))
        }
        onSelectNone={() => setSelected([])}
        onRun={() => start.mutate(selected)}
        runPending={start.isPending && (start.variables?.length ?? 0) !== 1}
        disabled={isRunning}
      />
    </div>
  );
}

/* ─── Latest run card ─────────────────────────────────────────────── */

function LatestRunCard({
  teamId,
  serverId,
  job,
  isRunning,
  onRetry,
  retryPending,
  onUpdateAgent,
  agentPending,
}: {
  teamId: string;
  serverId: string;
  job: ProvisioningJob | null;
  isRunning: boolean;
  onRetry: () => void;
  retryPending: boolean;
  onUpdateAgent: () => void;
  agentPending: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="label-mono mb-1 inline-flex items-center gap-2">
              <Zap className="h-3 w-3" /> Maintenance
            </div>
            <h2 className="text-[16px] text-ink-1">Latest run</h2>
            <p className="mt-1 text-[12px] text-ink-3 max-w-md">
              Re-run the last provisioning job after a regression, or update
              the agent binary in place — agent is always installed last so a
              re-run picks up a fresh build automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onUpdateAgent}
              loading={agentPending}
              disabled={isRunning}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Update agent
            </Button>
            <Button
              type="button"
              onClick={onRetry}
              loading={retryPending}
              disabled={isRunning || !job}
            >
              <RotateCw className="h-3.5 w-3.5" /> Re-run last
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {!job ? (
          <EmptyState
            icon={<Package className="h-4 w-4" />}
            title="No provisioning history yet"
            body="Pick the components you want installed below and click Run — the platform will SSH into the server and stream installer output here."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
              <div className="space-y-2">
                <div className="label-mono">Components</div>
                <div className="flex flex-wrap gap-1.5">
                  {job.components.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-line-1 bg-surface-2 px-2 h-6 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2"
                    >
                      <Package className="h-3 w-3 text-ink-3" />
                      {c}
                    </span>
                  ))}
                </div>
              </div>
              <RunMeta job={job} />
            </div>

            {job.status === "failed" && job.error && (
              <Alert tone="error">
                <span className="inline-flex items-center gap-2">
                  <TriangleAlert className="h-3.5 w-3.5" /> {job.error}
                </span>
              </Alert>
            )}

            <LogConsole
              teamId={teamId}
              serverId={serverId}
              job={job}
              isRunning={isRunning}
            />
          </>
        )}
      </CardBody>
    </Card>
  );
}

function RunMeta({ job }: { job: ProvisioningJob }) {
  return (
    <div className="space-y-2 text-right md:text-right">
      <StatusPill status={job.status} />
      <div className="font-mono text-[10px] text-ink-4 num space-y-0.5">
        <div>started {formatStamp(job.started_at)}</div>
        <div>
          {job.completed_at
            ? `finished ${formatStamp(job.completed_at)}`
            : "in flight…"}
        </div>
        <div>{formatDuration(job.started_at, job.completed_at)}</div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ProvisioningJob["status"] }) {
  const map: Record<
    ProvisioningJob["status"],
    { label: string; icon: React.ReactNode; klass: string }
  > = {
    pending: {
      label: "Pending",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      klass: "text-ink-3 border-line-1 bg-surface-2",
    },
    running: {
      label: "Running",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      klass: "text-signal border-signal/40 bg-[color:var(--signal-soft)]/30",
    },
    completed: {
      label: "Completed",
      icon: <CheckCircle2 className="h-3 w-3" />,
      klass: "text-online border-online/40 bg-online/10",
    },
    failed: {
      label: "Failed",
      icon: <XCircle className="h-3 w-3" />,
      klass: "text-alert border-alert/40 bg-alert/10",
    },
  };
  const { label, icon, klass } = map[status];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 " +
        "font-mono text-[10px] uppercase tracking-[0.14em] " +
        klass
      }
    >
      {icon}
      {label}
    </span>
  );
}

/* ─── Log console ────────────────────────────────────────────────── */

function LogConsole({
  teamId,
  serverId,
  job,
  isRunning,
}: {
  teamId: string;
  serverId: string;
  job: ProvisioningJob;
  isRunning: boolean;
}) {
  // Persisted logs are newline-separated raw lines. Live SSE delivers each new
  // line as a discrete event; we concatenate them onto the persisted base so
  // the user sees one continuous transcript.
  const [liveLines, setLiveLines] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset live buffer when the job id flips (a new run started).
  useEffect(() => {
    setLiveLines([]);
  }, [job.id]);

  useEffect(() => {
    if (!isRunning) return;
    const url = serverProvisionApi.logsUrl(teamId, serverId, job.id);
    const es = new EventSource(url, { withCredentials: true });
    es.onmessage = (e) => {
      // The handler sends the initial connect frame as JSON; ignore it so it
      // doesn't pollute the transcript.
      if (e.data.startsWith("{")) return;
      setLiveLines((prev) => [...prev, e.data]);
    };
    es.onerror = () => {
      // Let EventSource auto-reconnect; we close only when the parent decides
      // the job is no longer running.
    };
    return () => es.close();
  }, [teamId, serverId, job.id, isRunning]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [liveLines.length, job.logs]);

  const persisted = job.logs ? job.logs.split("\n") : [];
  const lines = [...persisted, ...liveLines].filter(Boolean);

  return (
    <div className="space-y-2">
      <header className="flex items-center justify-between gap-3">
        <div className="label-mono inline-flex items-center gap-2">
          <ScrollText className="h-3 w-3" /> Installer output
        </div>
        <span className="font-mono text-[10px] text-ink-4 num">
          {lines.length} lines
          {isRunning && (
            <>
              {" · "}
              <span className="inline-flex items-center gap-1 text-signal">
                <CircleDot className="h-3 w-3" /> live
              </span>
            </>
          )}
        </span>
      </header>
      <div
        ref={scrollRef}
        className="h-72 overflow-auto rounded-[var(--radius-md)] border border-line-1 bg-[#0a0d10] p-3 font-mono text-[11px] leading-5"
      >
        {lines.length === 0 ? (
          <p className="text-ink-4">
            {isRunning ? "Waiting for first output…" : "No log lines recorded."}
          </p>
        ) : (
          lines.map((line, i) => <LogLine key={i} line={line} />)
        )}
      </div>
    </div>
  );
}

function LogLine({ line }: { line: string }) {
  const cls = lineClass(line);
  return <div className={cls + " whitespace-pre-wrap break-words"}>{line}</div>;
}

function lineClass(line: string): string {
  if (line.startsWith("ERROR")) return "text-alert";
  if (line.startsWith("WARN")) return "text-warn";
  if (line.startsWith(">>>")) return "text-signal";
  return "text-ink-2";
}

/* ─── Component picker ───────────────────────────────────────────── */

function ComponentPickerCard({
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  onRun,
  runPending,
  disabled,
}: {
  selected: ProvisioningComponent[];
  onToggle: (c: ProvisioningComponent) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onRun: () => void;
  runPending: boolean;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="label-mono mb-1 inline-flex items-center gap-2">
              <Package className="h-3 w-3" /> Catalog
            </div>
            <h2 className="text-[16px] text-ink-1">Run components</h2>
            <p className="mt-1 text-[12px] text-ink-3 max-w-md">
              Picked components are installed in order over SSH. The
              <span className="font-mono text-ink-2"> agent</span> is always
              appended last so the server stays reachable after every run.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onSelectAll}
              className="h-7 px-2 rounded-[var(--radius-sm)] font-mono text-[10px] uppercase tracking-[0.14em] border border-line-1 text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
            >
              All
            </button>
            <button
              type="button"
              onClick={onSelectNone}
              className="h-7 px-2 rounded-[var(--radius-sm)] font-mono text-[10px] uppercase tracking-[0.14em] border border-line-1 text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
            >
              None
            </button>
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {PROVISIONING_COMPONENTS.map((c) => {
            const checked = selected.includes(c.id);
            return (
              <li key={c.id}>
                <label
                  className={
                    "flex items-start gap-3 rounded-[var(--radius-md)] border p-3 cursor-pointer transition-colors " +
                    (checked
                      ? "border-signal/50 bg-[color:var(--signal-soft)]/15"
                      : "border-line-1 bg-surface-1 hover:bg-surface-2")
                  }
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-3.5 w-3.5 accent-signal"
                    checked={checked}
                    onChange={() => onToggle(c.id)}
                    disabled={disabled}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[13px] text-ink-1">
                        {c.label}
                      </span>
                      <span className="font-mono text-[10px] text-ink-4">
                        {c.id}
                      </span>
                    </div>
                    <p className="text-[12px] text-ink-3 mt-0.5">
                      {c.description}
                    </p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-line-1">
          <span className="font-mono text-[11px] text-ink-3 num">
            {selected.length} of {PROVISIONING_COMPONENTS.length} selected
          </span>
          <Button
            type="button"
            onClick={onRun}
            loading={runPending}
            disabled={disabled || selected.length === 0}
          >
            <Play className="h-3.5 w-3.5" /> Run
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ─── Formatting helpers ─────────────────────────────────────────── */

function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const startMs = new Date(start).getTime();
  if (Number.isNaN(startMs)) return "—";
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(endMs)) return "—";
  const sec = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}
