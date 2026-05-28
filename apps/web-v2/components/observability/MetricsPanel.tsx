"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Activity, LineChart, TriangleAlert } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { EmptyState } from "@/components/primitives/EmptyState";
import { observabilityApi } from "@/lib/api";
import type { MetricRange, MetricSample } from "@/lib/types";
import { cn } from "@/lib/cn";

interface Props {
  teamId: string;
  scopeType: string;
  scopeId: string;
  /** Optional override — by default the panel uses whatever metrics the agent has reported. */
  preferredMetrics?: string[];
  /** Cap the visible chart count to keep the panel tidy. */
  maxCharts?: number;
}

const RANGES: { value: MetricRange; label: string }[] = [
  { value: "5m",  label: "5m"  },
  { value: "1h",  label: "1h"  },
  { value: "24h", label: "24h" },
  { value: "7d",  label: "7d"  },
  { value: "30d", label: "30d" },
];

/** Order metric names so the most-recognisable ones surface first. */
const DEFAULT_PRIORITY = [
  "cpu_percent",
  "memory_percent",
  "memory_used_bytes",
  "disk_percent",
  "load_1",
  "load_5",
  "network_rx_bytes",
  "network_tx_bytes",
  "request_rate",
  "p95_latency_ms",
];

export function MetricsPanel({
  teamId,
  scopeType,
  scopeId,
  preferredMetrics,
  maxCharts = 6,
}: Props) {
  const [range, setRange] = useState<MetricRange>("1h");

  // Pull the latest sample for each known metric to discover what's collected.
  const latest = useQuery({
    queryKey: ["metrics-latest", teamId, scopeType, scopeId],
    queryFn: () => observabilityApi.latestMetrics(teamId, scopeType, scopeId),
    refetchInterval: 30_000,
  });

  const names = useMemo(() => {
    const list = preferredMetrics ?? uniq((latest.data ?? []).map((s) => s.metric_name));
    return prioritise(list, DEFAULT_PRIORITY).slice(0, maxCharts);
  }, [latest.data, preferredMetrics, maxCharts]);

  // One range query per metric. useQueries batches them so the panel stays
  // responsive even when there are 6 charts in flight.
  const series = useQueries({
    queries: names.map((name) => ({
      queryKey: ["metric-range", teamId, scopeType, scopeId, name, range],
      queryFn: () =>
        observabilityApi.metricRange(teamId, scopeType, scopeId, name, range, 240),
      refetchInterval: 30_000,
      enabled: !!name,
    })),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="label-mono mb-1 inline-flex items-center gap-2">
              <LineChart className="h-3 w-3" /> Telemetry
            </div>
            <h2 className="text-[16px] text-ink-1">Metrics</h2>
            <p className="mt-1 text-[12px] text-ink-3 max-w-md">
              Live sampled metrics from the agent. Click a range to widen the
              window — charts update on a 30s cadence.
            </p>
          </div>
          <div className="flex items-center gap-1">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                className={cn(
                  "h-8 px-3 rounded-[var(--radius-sm)] font-mono text-[11px] border transition-colors",
                  range === r.value
                    ? "border-signal bg-[color:var(--signal-soft)]/30 text-ink-1"
                    : "border-line-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardBody>
        {names.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-4 w-4" />}
            title={latest.isLoading ? "Loading metrics…" : "No metrics yet"}
            body={
              latest.isLoading
                ? "Pulling the latest sample list."
                : "The agent hasn't reported metrics for this resource yet. Once it does, charts appear here."
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {names.map((name, i) => {
              const q = series[i];
              return (
                <MetricChart
                  key={name}
                  name={name}
                  samples={q?.data ?? []}
                  loading={q?.isLoading ?? false}
                  error={
                    q?.error instanceof Error ? q.error.message : null
                  }
                />
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function MetricChart({
  name,
  samples,
  loading,
  error,
}: {
  name: string;
  samples: MetricSample[];
  loading: boolean;
  error: string | null;
}) {
  const latestValue = samples[samples.length - 1]?.value;
  const min = samples.length ? Math.min(...samples.map((s) => s.value)) : 0;
  const max = samples.length ? Math.max(...samples.map((s) => s.value)) : 0;

  return (
    <div className="rounded-[var(--radius-md)] border border-line-1 bg-surface-1 p-3.5">
      <header className="flex items-baseline justify-between">
        <div className="label-mono">{prettyName(name)}</div>
        <div className="font-mono text-[10px] text-ink-4 num">
          {samples.length} pts
        </div>
      </header>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-[22px] text-ink-1 num">
          {latestValue != null ? formatValue(name, latestValue) : "—"}
        </span>
        {samples.length > 0 && (
          <span className="font-mono text-[10px] text-ink-3 num">
            min {formatValue(name, min)} · max {formatValue(name, max)}
          </span>
        )}
      </div>
      <div className="mt-2">
        {error ? (
          <div className="text-[12px] text-alert inline-flex items-center gap-1.5 h-[64px]">
            <TriangleAlert className="h-3 w-3" /> {error}
          </div>
        ) : loading && samples.length === 0 ? (
          <div className="h-[64px] grid place-items-center text-[11px] text-ink-3">
            loading…
          </div>
        ) : samples.length === 0 ? (
          <div className="h-[64px] grid place-items-center text-[11px] text-ink-3">
            no data in this window
          </div>
        ) : (
          <Sparkline samples={samples} />
        )}
      </div>
    </div>
  );
}

function Sparkline({ samples }: { samples: MetricSample[] }) {
  const w = 320;
  const h = 64;
  const padX = 2;
  const padY = 4;

  // Build {x,y} points in SVG space — sorted ascending by sample time.
  const sorted = useMemo(
    () =>
      [...samples].sort(
        (a, b) => new Date(a.sampled_at).getTime() - new Date(b.sampled_at).getTime(),
      ),
    [samples],
  );

  if (sorted.length < 2) {
    return (
      <div className="h-[64px] grid place-items-center text-[11px] text-ink-3">
        Not enough data yet.
      </div>
    );
  }

  const xs = sorted.map((s) => new Date(s.sampled_at).getTime());
  const ys = sorted.map((s) => s.value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xRange = Math.max(1, maxX - minX);
  // Add a small fudge so a flat line still shows up off the floor.
  const yRange = Math.max(1e-6, maxY - minY);

  const pts = sorted.map((s) => {
    const x = padX + ((new Date(s.sampled_at).getTime() - minX) / xRange) * (w - padX * 2);
    const y = h - padY - ((s.value - minY) / yRange) * (h - padY * 2);
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const fill = `${line} L${pts[pts.length - 1][0]},${h - padY} L${pts[0][0]},${h - padY} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="w-full h-[64px]"
      aria-hidden
    >
      <defs>
        <linearGradient id="spark-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--signal)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#spark-fade)" />
      <path d={line} fill="none" stroke="var(--signal)" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function uniq(list: string[]): string[] {
  return Array.from(new Set(list));
}

function prioritise(list: string[], priority: string[]): string[] {
  const set = new Set(list);
  const head = priority.filter((p) => set.has(p));
  const tail = list.filter((n) => !head.includes(n)).sort();
  return [...head, ...tail];
}

const NICE_NAMES: Record<string, string> = {
  cpu_percent: "CPU utilisation",
  memory_percent: "Memory utilisation",
  memory_used_bytes: "Memory used",
  disk_percent: "Disk utilisation",
  load_1: "Load · 1m",
  load_5: "Load · 5m",
  network_rx_bytes: "Network in",
  network_tx_bytes: "Network out",
  request_rate: "Request rate",
  p95_latency_ms: "P95 latency",
};

function prettyName(name: string): string {
  return NICE_NAMES[name] ?? name;
}

function formatValue(name: string, v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (name.endsWith("_bytes")) return formatBytes(v);
  if (name.endsWith("_percent")) return `${v.toFixed(1)}%`;
  if (name.endsWith("_ms")) return `${v.toFixed(0)} ms`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
