import { ChevronRight, Check } from "lucide-react";

/* Scene 5 — Deploy. Multi-phase progress (5 phases tick through in
   sequence), denser log with timestamps + level chips, per-region
   rollout cards showing replica counts and health-check timings,
   build stats sidebar (image size, cache hit, layers). */

const PHASES = ["resolve", "build", "push", "rollout", "verify"];

const LOG_LINES: { t: string; lvl: "info" | "ok"; msg: string }[] = [
  { t: "14:08:01", lvl: "info", msg: "resolving cluster prod-edge (3 nodes)" },
  { t: "14:08:02", lvl: "info", msg: "fetching commit a1c8e02 from orbit/api" },
  { t: "14:08:04", lvl: "info", msg: "building image · cache HIT (87%) · 4 layers" },
  { t: "14:08:18", lvl: "info", msg: "pushing 18.4 MB to registry.orbit.internal" },
  { t: "14:08:24", lvl: "info", msg: "rolling out 1/3 · us-east-1 · 2 replicas" },
  { t: "14:08:31", lvl: "info", msg: "rolling out 2/3 · fra-1 · 2 replicas" },
  { t: "14:08:38", lvl: "info", msg: "rolling out 3/3 · sgp-1 · 2 replicas" },
  { t: "14:08:42", lvl: "info", msg: "routing · TLS issued by letsencrypt-prod" },
  { t: "14:08:43", lvl: "ok",   msg: "v124 live · 38s end-to-end" },
];

export function SceneDeploy() {
  return (
    <div className="scene-deploy h-full p-5 sm:p-7 relative">
      <div className="flex items-center gap-1.5 font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3 mb-2">
        <span>Projects</span>
        <ChevronRight className="h-2.5 w-2.5" />
        <span>orbit-api</span>
        <ChevronRight className="h-2.5 w-2.5" />
        <span className="text-ink-1">Deploy v124</span>
      </div>

      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display italic text-[22px] sm:text-2xl text-ink-1 leading-tight">
            Deploy · v124
          </h3>
          <div className="mt-1 font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
            production · main@a1c8e02 · triggered by ada
          </div>
        </div>
        <span className="demo-deploy-status inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--radius-sm)] border border-[color-mix(in_oklch,var(--warn)_30%,transparent)] bg-[color-mix(in_oklch,var(--warn)_18%,transparent)] text-warn font-mono uppercase tracking-[0.14em] text-[10px]">
          <span className="h-1.5 w-1.5 rounded-full bg-warn" />
          <span className="demo-deploy-status-label">building</span>
        </span>
      </div>

      {/* Multi-phase progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
            Pipeline
          </span>
          <span className="font-mono text-[10px] text-ink-3">
            <span className="demo-deploy-phase text-signal">resolve</span>
            <span className="text-ink-4 mx-1.5">→</span>
            <span className="text-ink-4">build → push → rollout → verify</span>
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {PHASES.map((p, i) => (
            <div key={p} className="space-y-1">
              <div className="h-[3px] rounded-full bg-surface-3 overflow-hidden">
                <div className={`demo-phase-fill demo-phase-fill-${i} h-full bg-signal`} />
              </div>
              <div className="font-mono uppercase tracking-[0.14em] text-[8.5px] text-ink-3 text-center">
                {p}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr] gap-3">
        {/* Log stream */}
        <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line-1 bg-surface-2">
            <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
              Build log
            </span>
            <span className="font-mono text-[9px] text-ink-4">live · 9 lines</span>
          </div>
          <ol className="px-3 py-2 font-mono text-[10.5px] leading-[1.7] text-ink-2 min-h-[176px]">
            {LOG_LINES.map((line, i) => (
              <li
                key={i}
                className={`demo-log-line demo-log-line-${i} grid grid-cols-[64px_36px_1fr] gap-2 items-baseline ${
                  line.lvl === "ok" ? "text-online" : ""
                }`}
              >
                <span className="text-ink-4">{line.t}</span>
                <span
                  className={`font-mono uppercase tracking-[0.14em] text-[8.5px] px-1 rounded-[3px] text-center ${
                    line.lvl === "ok"
                      ? "text-online bg-[color-mix(in_oklch,var(--online)_18%,transparent)]"
                      : "text-ink-3 bg-surface-2"
                  }`}
                >
                  {line.lvl}
                </span>
                <span className="truncate">{line.msg}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Right column: per-region cards + build stats */}
        <div className="space-y-3">
          <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 overflow-hidden">
            <div className="px-3 py-2 border-b border-line-1 bg-surface-2 font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
              Region rollout
            </div>
            <ul className="divide-y divide-line-1">
              <RegionCard name="us-east-1" idx="0" />
              <RegionCard name="fra-1"     idx="1" />
              <RegionCard name="sgp-1"     idx="2" />
            </ul>
          </div>

          <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 p-3">
            <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3 mb-2.5">
              Build stats
            </div>
            <ul className="space-y-1.5 text-[10.5px]">
              <Stat k="Image size"     v="42.6 MB" />
              <Stat k="Layer cache"    v="87%"    tone="online" />
              <Stat k="Build duration" v="14.3 s" />
              <Stat k="Push duration"  v="6.1 s" />
              <Stat k="Total"          v="38 s"   tone="online" />
            </ul>
          </div>
        </div>
      </div>

      {/* Success toast slides in at the end */}
      <div className="demo-deploy-toast absolute bottom-5 right-5 sm:bottom-7 sm:right-7 inline-flex items-center gap-2 h-8 px-3 rounded-[var(--radius-sm)] border border-[color-mix(in_oklch,var(--online)_30%,transparent)] bg-[color-mix(in_oklch,var(--online)_18%,transparent)] text-[color:var(--online)]">
        <Check className="h-3 w-3" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
          v124 live · 38s
        </span>
      </div>
    </div>
  );
}

function RegionCard({ name, idx }: { name: string; idx: "0" | "1" | "2" }) {
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="flex items-center gap-2 text-[11.5px] text-ink-1">
          <span className={`demo-region-pip demo-region-pip-${idx} h-1.5 w-1.5 rounded-full bg-ink-4`} />
          {name}
        </span>
        <span
          className={`demo-region-label demo-region-label-${idx} font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3`}
        >
          queued
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[9.5px] font-mono text-ink-3">
        <span>
          <span className="text-ink-4">replicas</span> <span className="text-ink-2 num">2/2</span>
        </span>
        <span className="text-right">
          <span className="text-ink-4">/healthz</span>{" "}
          <span className="text-ink-2 num">412 ms</span>
        </span>
      </div>
    </li>
  );
}

function Stat({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "online";
}) {
  const valueCls = tone === "online" ? "text-online" : "text-ink-1";
  return (
    <li className="flex items-center justify-between">
      <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">{k}</span>
      <span className={`font-mono num ${valueCls}`}>{v}</span>
    </li>
  );
}
