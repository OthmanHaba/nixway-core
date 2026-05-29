import { Plus, Server, Cpu, MemoryStick, HardDrive, Check } from "lucide-react";

/* Scene 1 — Servers. Now shows a populated fleet (2 servers already
   online), a real-looking install log streaming in the side drawer,
   and the new server joining at the end with provisioning → online. */

export function SceneServers() {
  return (
    <div className="scene-servers h-full p-5 sm:p-7 relative">
      {/* Header + KPI strip */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
            Infrastructure
          </div>
          <h3 className="font-display italic text-[22px] sm:text-2xl text-ink-1 leading-tight mt-1">
            Servers
          </h3>
        </div>
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] bg-signal text-[color:var(--signal-ink)] font-mono uppercase tracking-[0.14em] text-[10px] font-medium shadow-[inset_0_1px_0_color-mix(in_oklch,white_30%,transparent)]"
        >
          <Plus className="h-3 w-3" />
          Add server
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-4">
        <Kpi label="Total"        value="3" />
        <Kpi label="Online"       value="2" tone="online" />
        <Kpi label="Provisioning" value="1" tone="warn" />
        <Kpi label="Drift"        value="0" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_280px] gap-3">
        {/* Fleet table */}
        <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 overflow-hidden">
          <div className="grid grid-cols-[1fr_70px_70px_70px] gap-2 px-3 py-2 border-b border-line-1 bg-surface-2 font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
            <span>Server</span>
            <span>Region</span>
            <span>Load</span>
            <span>Status</span>
          </div>
          <ul className="divide-y divide-line-1">
            <ServerRow name="us-east-01" region="us-east-1" load={32} status="online" />
            <ServerRow name="sgp-edge-01" region="sgp-1"    load={47} status="online" />
            <ServerRow name="fra-edge-01" region="fra-1"    load={0}  status="provisioning" newRow />
          </ul>
        </div>

        {/* Selected server detail */}
        <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Server className="h-3.5 w-3.5 text-signal" />
            <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
              fra-edge-01 · spec
            </div>
          </div>
          <ul className="space-y-2 text-[11px]">
            <SpecRow icon={Cpu}         label="CPU"    value="4 vCPU · Graviton" />
            <SpecRow icon={MemoryStick} label="Memory" value="8 GB DDR5" />
            <SpecRow icon={HardDrive}   label="Disk"   value="80 GB NVMe" />
          </ul>
          <div className="mt-4 pt-3 border-t border-line-1">
            <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3 mb-1.5">
              Kernel
            </div>
            <div className="font-mono text-[10.5px] text-ink-2">
              Linux 6.8.0-31 · aarch64
            </div>
          </div>
        </div>
      </div>

      {/* Sliding drawer with the "Add server" form + install log */}
      <div
        aria-hidden
        className="demo-drawer absolute top-0 right-0 h-full w-[280px] sm:w-[320px] border-l border-line-1 bg-surface-1 p-5 shadow-[-12px_0_30px_-10px_color-mix(in_oklch,var(--ink-1)_50%,transparent)] overflow-hidden"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
            Install agent
          </div>
          <div className="demo-drawer-phase font-mono text-[10px] text-signal">
            phase 3/5
          </div>
        </div>
        <Field label="Name" value="fra-edge-01" />
        <Field label="SSH endpoint" value="ubuntu@5.75.198.42" mono />
        <Field label="Region" value="fra-1" />

        {/* Install log streams as the drawer is open */}
        <div className="mt-3 rounded-[var(--radius-sm)] border border-line-1 bg-surface-0 p-2.5 font-mono text-[10px] leading-[1.55] text-ink-2 h-[112px] overflow-hidden">
          <div className="demo-install-line demo-install-line-0">
            <span className="text-ink-4">14:02:18</span> ssh handshake ok
          </div>
          <div className="demo-install-line demo-install-line-1">
            <span className="text-ink-4">14:02:19</span> writing systemd unit
          </div>
          <div className="demo-install-line demo-install-line-2">
            <span className="text-ink-4">14:02:21</span> agent v0.4.0 downloaded
          </div>
          <div className="demo-install-line demo-install-line-3">
            <span className="text-ink-4">14:02:23</span> mTLS cert issued
          </div>
          <div className="demo-install-line demo-install-line-4 text-online">
            <span className="text-ink-4">14:02:24</span> ✓ heartbeat ok
          </div>
        </div>

        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="demo-drawer-submit relative w-full mt-3 inline-flex items-center justify-center gap-1.5 h-8 rounded-[var(--radius-sm)] bg-signal text-[color:var(--signal-ink)] font-mono uppercase tracking-[0.14em] text-[10px] font-medium shadow-[inset_0_1px_0_color-mix(in_oklch,white_30%,transparent)]"
        >
          <Check className="h-3 w-3" />
          Finish setup
        </button>
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
  tone?: "online" | "warn";
}) {
  const toneCls =
    tone === "online" ? "text-online" : tone === "warn" ? "text-warn" : "text-ink-1";
  return (
    <div className="rounded-[var(--radius-sm)] border border-line-1 bg-surface-1 px-3 py-2">
      <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
        {label}
      </div>
      <div className={`font-mono text-[18px] leading-none mt-1 num ${toneCls}`}>
        {value}
      </div>
    </div>
  );
}

function ServerRow({
  name,
  region,
  load,
  status,
  newRow,
}: {
  name: string;
  region: string;
  load: number;
  status: "online" | "provisioning";
  newRow?: boolean;
}) {
  const pip =
    status === "online" ? "bg-online" : "bg-warn";
  const label =
    status === "online" ? "online" : "provisioning";
  return (
    <li
      className={`grid grid-cols-[1fr_70px_70px_70px] gap-2 px-3 py-2.5 items-center text-[11.5px] ${
        newRow ? "demo-row-appear" : ""
      }`}
    >
      <span className="flex items-center gap-2 text-ink-1 truncate">
        <Server className="h-3 w-3 text-ink-3" />
        {name}
      </span>
      <span className="font-mono text-[10px] text-ink-2">{region}</span>
      <div className="flex items-center gap-1.5">
        <div className="h-[3px] flex-1 rounded-full bg-surface-3 overflow-hidden">
          <div
            className="h-full bg-signal/70"
            style={{ width: `${load}%`, transition: "width 600ms ease-out" }}
          />
        </div>
        <span className="font-mono text-[9.5px] text-ink-3 num w-6 text-right">{load}%</span>
      </div>
      <span
        className={`inline-flex items-center gap-1.5 ${newRow ? "demo-status-wrap" : ""}`}
      >
        <span
          className={`${newRow ? "demo-status-pip" : pip} h-1.5 w-1.5 rounded-full ${
            !newRow ? pip : ""
          }`}
        />
        <span
          className={`${newRow ? "demo-status-label" : ""} font-mono uppercase tracking-[0.14em] text-[9px] ${
            status === "online" ? "text-online" : "text-warn"
          }`}
        >
          {label}
        </span>
      </span>
    </li>
  );
}

function SpecRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <li className="flex items-center gap-2.5">
      <Icon className="h-3 w-3 text-ink-3 shrink-0" />
      <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3 w-12">
        {label}
      </span>
      <span className="font-mono text-[10.5px] text-ink-1">{value}</span>
    </li>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="mb-2.5">
      <div className="font-mono uppercase tracking-[0.14em] text-[8.5px] text-ink-3 mb-1">
        {label}
      </div>
      <div
        className={`h-7 px-2 rounded-[var(--radius-sm)] border border-line-1 bg-surface-0 flex items-center text-[11px] text-ink-1 ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
