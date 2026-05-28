"use client";

import { useQuery } from "@tanstack/react-query";
import { Cpu, MemoryStick, Activity, CircleDot } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { serversApi } from "@/lib/api";

interface Props {
  teamId: string;
  serverId: string;
}

export function ServerLiveMetrics({ teamId, serverId }: Props) {
  // Polls the latest agent-reported snapshot. Matches the agent's ~30s cadence;
  // shorter intervals would mostly return the same row.
  const q = useQuery({
    queryKey: ["server-metrics", teamId, serverId],
    queryFn: () => serversApi.metrics(teamId, serverId),
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });

  const m = q.data;
  const hasSample = !!m && !!m.updated_at;
  const cpu = m?.cpu_percent ?? 0;
  const memPct = m?.memory_percent ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="label-mono mb-1 flex items-center gap-2">
              <Activity className="h-3 w-3" /> Live snapshot
            </div>
            <h2 className="text-[16px] text-ink-1">CPU &amp; memory</h2>
          </div>
          <FreshnessPill state={pillState(q.isLoading, hasSample, m?.fresh)} />
        </div>
      </CardHeader>
      <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Gauge
          icon={<Cpu className="h-3 w-3" />}
          label="CPU"
          value={hasSample ? `${cpu.toFixed(1)}%` : "—"}
          pct={hasSample ? cpu : null}
        />
        <Gauge
          icon={<MemoryStick className="h-3 w-3" />}
          label="Memory"
          value={hasSample ? `${memPct.toFixed(1)}%` : "—"}
          sub={hasSample ? `${formatBytes(m!.memory_used)} / ${formatBytes(m!.memory_total)}` : null}
          pct={hasSample ? memPct : null}
        />
      </CardBody>
    </Card>
  );
}

type PillState = "loading" | "live" | "stale" | "empty";

function pillState(loading: boolean, hasSample: boolean, fresh?: boolean): PillState {
  if (loading && !hasSample) return "loading";
  if (!hasSample) return "empty";
  return fresh ? "live" : "stale";
}

function FreshnessPill({ state }: { state: PillState }) {
  const map: Record<PillState, { label: string; klass: string }> = {
    loading: { label: "Loading",  klass: "text-ink-3 border-line-1 bg-surface-2" },
    live:    { label: "Live",     klass: "text-online border-online/40 bg-online/10" },
    stale:   { label: "Stale",    klass: "text-warn border-warn/40 bg-warn/10" },
    empty:   { label: "No data",  klass: "text-ink-3 border-line-1 bg-surface-2" },
  };
  const { label, klass } = map[state];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 " +
        "font-mono text-[10px] uppercase tracking-[0.14em] " +
        klass
      }
    >
      <CircleDot className="h-3 w-3" />
      {label}
    </span>
  );
}

function Gauge({
  icon,
  label,
  value,
  pct,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  pct: number | null;
  sub?: string | null;
}) {
  const clamped = pct == null ? null : Math.max(0, Math.min(100, pct));
  const tone =
    clamped == null ? "bg-surface-3" :
    clamped > 85   ? "bg-alert" :
    clamped > 65   ? "bg-warn"  :
                     "bg-online";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="label-mono flex items-center gap-2">{icon} {label}</div>
        {sub && (
          <span className="font-mono text-[10px] text-ink-3 num">{sub}</span>
        )}
      </div>
      <div className="font-mono text-[28px] text-ink-1 leading-none num">{value}</div>
      <div className="h-[3px] rounded-full bg-surface-3 overflow-hidden">
        {clamped != null && (
          <div
            className={`${tone} h-full transition-[width] duration-500`}
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
}
