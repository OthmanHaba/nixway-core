import { Server, Network, Boxes, Rocket, ArrowUpRight, Activity, Zap } from "lucide-react";

/* Scene 6 — Mission control overview. Stat tiles each with their
   own sparkline, live metrics row (req/s, p95, error rate), recent
   deploys list, and a richer activity feed. */

export function SceneOverview() {
  return (
    <div className="scene-overview h-full p-5 sm:p-7 relative">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
            Console · overview
          </div>
          <h3 className="font-display italic text-[22px] sm:text-2xl text-ink-1 leading-tight mt-1">
            Mission control · orbit
          </h3>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 h-6 px-2 rounded-[var(--radius-sm)] border border-[color-mix(in_oklch,var(--online)_30%,transparent)] bg-[color-mix(in_oklch,var(--online)_18%,transparent)] text-online font-mono uppercase tracking-[0.14em] text-[9.5px]">
          <span className="h-1 w-1 rounded-full bg-online" />
          all systems normal
        </span>
      </div>

      {/* Stat tiles with sparklines */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <StatTile icon={Server}   label="Servers"   value="3" sub="all online"  spark={[1,1,2,2,2,2,3,3,3,3,3,3]} delay="0" />
        <StatTile icon={Network}  label="Clusters"  value="1" sub="mesh formed" spark={[0,0,0,0,0,1,1,1,1,1,1,1]} delay="1" />
        <StatTile icon={Boxes}    label="Projects"  value="1" sub="1 app · 2 envs" spark={[0,0,0,1,1,1,1,1,1,1,1,1]} delay="2" />
        <StatTile icon={Rocket}   label="Deploys"   value="12" sub="today"      spark={[2,1,3,4,2,5,4,6,3,7,5,12]} delay="3" />
      </div>

      {/* Live metrics row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Metric icon={Zap}      label="Req / sec"      value="1,284" tone="online" delay="0" />
        <Metric icon={Activity} label="p95 latency"    value="84 ms"               delay="1" />
        <Metric icon={Activity} label="Error rate"     value="0.02 %" tone="online" delay="2" />
      </div>

      {/* Two-column: recent deploys + activity feed */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-line-1 bg-surface-2 flex items-center justify-between">
            <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
              Recent deploys
            </span>
            <ArrowUpRight className="h-3 w-3 text-ink-3" />
          </div>
          <ul className="divide-y divide-line-1">
            <DeployRow app="orbit-api" version="v124" when="just now" duration="38 s" delay="0" highlighted />
            <DeployRow app="orbit-api" version="v123" when="9m ago"   duration="41 s" delay="1" />
            <DeployRow app="orbit-api" version="v122" when="2h ago"   duration="36 s" delay="2" />
          </ul>
        </div>

        <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-line-1 bg-surface-2 flex items-center justify-between">
            <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
              Activity
            </span>
            <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-4">
              last 1h
            </span>
          </div>
          <ul className="divide-y divide-line-1">
            <ActivityRow tone="signal" actor="ada"     action="deployed orbit-api v124" when="just now" delay="0" />
            <ActivityRow tone="online" actor="agent"   action="mesh key rotated"        when="2h ago"   delay="1" />
            <ActivityRow tone="info"   actor="github"  action="webhook push main"       when="2h ago"   delay="2" />
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  spark,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  spark: number[];
  delay: "0" | "1" | "2" | "3";
}) {
  return (
    <div
      className={`demo-overview-stat demo-overview-stat-${delay} rounded-[var(--radius)] border border-line-1 bg-surface-1 p-3`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-ink-3" />
          <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
            {label}
          </span>
        </div>
        <span className="h-1 w-1 rounded-full bg-online" />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="font-mono text-[22px] text-ink-1 leading-none num">{value}</div>
          <div className="mt-1.5 text-[10px] text-ink-3">{sub}</div>
        </div>
        <Sparkline values={spark} />
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "online";
  delay: "0" | "1" | "2";
}) {
  return (
    <div
      className={`demo-overview-bar demo-overview-bar-${delay} rounded-[var(--radius-sm)] border border-line-1 bg-surface-1 px-3 py-2`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-ink-3" />
        <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
          {label}
        </span>
      </div>
      <div className={`font-mono text-[15px] num ${tone === "online" ? "text-online" : "text-ink-1"}`}>
        {value}
      </div>
    </div>
  );
}

function DeployRow({
  app,
  version,
  when,
  duration,
  highlighted,
  delay,
}: {
  app: string;
  version: string;
  when: string;
  duration: string;
  highlighted?: boolean;
  delay: "0" | "1" | "2";
}) {
  return (
    <li
      className={`demo-overview-row demo-overview-row-${delay} flex items-center gap-3 px-3 py-2.5 ${
        highlighted ? "bg-[color-mix(in_oklch,var(--signal)_8%,transparent)]" : ""
      }`}
    >
      <span className="h-5 w-5 rounded-full border border-line-1 bg-surface-2 grid place-items-center text-ink-3 shrink-0">
        <Rocket className="h-2.5 w-2.5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-mono text-[11px] text-ink-1 truncate">
          {app} {version}
        </span>
        <span className="block text-[10px] text-online">live · {duration}</span>
      </span>
      <time className="font-mono text-[9px] text-ink-4 shrink-0">{when}</time>
    </li>
  );
}

function ActivityRow({
  tone,
  actor,
  action,
  when,
  delay,
}: {
  tone: "signal" | "online" | "info";
  actor: string;
  action: string;
  when: string;
  delay: "0" | "1" | "2";
}) {
  const dotCls =
    tone === "signal" ? "bg-signal" : tone === "online" ? "bg-online" : "bg-info";
  return (
    <li
      className={`demo-overview-row demo-overview-row-${delay} flex items-center gap-3 px-3 py-2.5`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotCls} shrink-0`} />
      <span className="flex-1 min-w-0">
        <span className="block text-[11px] text-ink-1 truncate">
          <span className="font-mono text-ink-2">{actor}</span> {action}
        </span>
      </span>
      <time className="font-mono text-[9px] text-ink-4 shrink-0">{when}</time>
    </li>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 50},${20 - (v / max) * 16 - 2}`)
    .join(" ");
  return (
    <svg viewBox="0 0 50 20" className="h-5 w-12 shrink-0" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="var(--signal)"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
