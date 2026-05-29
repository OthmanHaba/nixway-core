import { Plus, Network, Activity } from "lucide-react";

/* Scene 2 — Clusters & mesh formation. Members table with CPU/mem
   load mini-bars, mesh diagram with latency labels and live pulse
   dots flowing along the links, plus a mesh-stats panel on the right. */

export function SceneClusters() {
  return (
    <div className="scene-clusters h-full p-5 sm:p-7 relative">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
            Infrastructure
          </div>
          <h3 className="font-display italic text-[22px] sm:text-2xl text-ink-1 leading-tight mt-1">
            Cluster · prod-edge
          </h3>
        </div>
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] border border-line-2 bg-surface-1 text-ink-1 font-mono uppercase tracking-[0.14em] text-[10px] font-medium"
        >
          <Plus className="h-3 w-3" />
          Add server
        </button>
      </div>

      {/* Mesh KPI strip */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <Kpi label="Nodes"   value="3/3"     tone="online" />
        <Kpi label="Links"   value="3/3"     tone="online" />
        <Kpi label="p50 RTT" value="23 ms"  />
        <Kpi label="Bytes"   value="14.2 GB" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-3">
        {/* Member list with load bars */}
        <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 p-3">
          <div className="flex items-center gap-2 mb-2.5">
            <Network className="h-3.5 w-3.5 text-signal" />
            <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
              Cluster members
            </div>
            <span className="ml-auto demo-mesh-status-text font-mono uppercase tracking-[0.14em] text-[9px] text-warn">
              forming overlay
            </span>
          </div>
          <ul className="space-y-2">
            <Member name="us-east-1"  provider="aws"          cpu={32} mem={48} delay="0" />
            <Member name="fra-1"      provider="hetzner"      cpu={47} mem={61} delay="1" />
            <Member name="sgp-1"      provider="digitalocean" cpu={28} mem={39} delay="2" />
          </ul>
        </div>

        {/* Right: mesh diagram + stats stacked */}
        <div className="space-y-3">
          <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 p-3">
            <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3 mb-1">
              Mesh topology
            </div>
            <svg viewBox="0 0 240 200" className="w-full h-auto">
              {/* Lines first so circles sit on top */}
              <line className="demo-mesh-line demo-mesh-line-1" x1="40" y1="55" x2="200" y2="55" />
              <line className="demo-mesh-line demo-mesh-line-2" x1="40" y1="55" x2="120" y2="165" />
              <line className="demo-mesh-line demo-mesh-line-3" x1="200" y1="55" x2="120" y2="165" />

              {/* Latency labels along each link */}
              <text className="demo-mesh-latency demo-mesh-latency-1" x="120" y="48" textAnchor="middle">
                72 ms
              </text>
              <text className="demo-mesh-latency demo-mesh-latency-2" x="68" y="118" textAnchor="middle">
                23 ms
              </text>
              <text className="demo-mesh-latency demo-mesh-latency-3" x="172" y="118" textAnchor="middle">
                89 ms
              </text>

              {/* Pulse dots flowing along the links */}
              <circle className="demo-mesh-pulse demo-mesh-pulse-1" r="2.5" />
              <circle className="demo-mesh-pulse demo-mesh-pulse-2" r="2.5" />
              <circle className="demo-mesh-pulse demo-mesh-pulse-3" r="2.5" />

              {/* Nodes */}
              <g className="demo-mesh-node demo-mesh-node-1">
                <circle cx="40" cy="55" r="9" />
                <text x="40" y="36" textAnchor="middle">us-east</text>
              </g>
              <g className="demo-mesh-node demo-mesh-node-2">
                <circle cx="200" cy="55" r="9" />
                <text x="200" y="36" textAnchor="middle">fra</text>
              </g>
              <g className="demo-mesh-node demo-mesh-node-3">
                <circle cx="120" cy="165" r="9" />
                <text x="120" y="187" textAnchor="middle">sgp</text>
              </g>
            </svg>
          </div>

          <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 p-3">
            <div className="flex items-center gap-2 mb-2.5">
              <Activity className="h-3 w-3 text-signal" />
              <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
                Mesh stats
              </div>
            </div>
            <ul className="space-y-1.5 text-[10.5px]">
              <StatRow k="Key rotation" v="2h ago" />
              <StatRow k="Packet loss"  v="0.00 %" />
              <StatRow k="Encryption"   v="ChaCha20" />
              <StatRow k="Routing"      v="WireGuard" />
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "online";
}) {
  const toneCls = tone === "online" ? "text-online" : "text-ink-1";
  return (
    <div className="rounded-[var(--radius-sm)] border border-line-1 bg-surface-1 px-3 py-2">
      <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
        {label}
      </div>
      <div className={`font-mono text-[16px] leading-none mt-1 num ${toneCls}`}>
        {value}
      </div>
    </div>
  );
}

function Member({
  name,
  provider,
  cpu,
  mem,
  delay,
}: {
  name: string;
  provider: string;
  cpu: number;
  mem: number;
  delay: "0" | "1" | "2";
}) {
  return (
    <li
      className={`demo-cluster-row demo-cluster-row-${delay} rounded-[var(--radius-sm)] border border-line-1 bg-surface-0 px-3 py-2`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="flex items-center gap-2 text-ink-1 text-[12px]">
          <span className="h-1.5 w-1.5 rounded-full bg-online" />
          {name}
        </span>
        <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
          {provider}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 text-[9.5px]">
        <LoadBar label="cpu" pct={cpu} />
        <LoadBar label="mem" pct={mem} />
      </div>
    </li>
  );
}

function LoadBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="font-mono uppercase tracking-[0.14em] text-ink-3">{label}</span>
        <span className="font-mono text-ink-2 num">{pct}%</span>
      </div>
      <div className="h-[2px] rounded-full bg-surface-3 overflow-hidden">
        <div
          className="h-full bg-signal/70"
          style={{ width: `${pct}%`, transition: "width 600ms ease-out" }}
        />
      </div>
    </div>
  );
}

function StatRow({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">{k}</span>
      <span className="font-mono text-ink-1 num">{v}</span>
    </li>
  );
}
