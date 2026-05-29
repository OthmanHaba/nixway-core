import { Plus, ChevronRight, GitBranch, Globe, KeyRound } from "lucide-react";

/* Scene 4 — App detail. Tabs, app row, env cards each with a tiny
   deploy frequency sparkline, env vars panel, domains panel with TLS
   status pips. Two-column dense layout. */

export function SceneApp() {
  return (
    <div className="scene-app h-full p-5 sm:p-7 relative">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3 mb-3">
        <span>Projects</span>
        <ChevronRight className="h-2.5 w-2.5" />
        <span className="text-ink-1">orbit-api</span>
      </div>

      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-display italic text-[22px] sm:text-2xl text-ink-1 leading-tight">
          orbit-api
        </h3>
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] bg-signal text-[color:var(--signal-ink)] font-mono uppercase tracking-[0.14em] text-[10px] font-medium shadow-[inset_0_1px_0_color-mix(in_oklch,white_30%,transparent)]"
        >
          <Plus className="h-3 w-3" />
          Add app
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-5 border-b border-line-1 mb-4 text-[11px]">
        {["Apps", "Environments", "Domains", "Secrets", "Deploys"].map((t, i) => {
          const active = i === 0;
          return (
            <span
              key={t}
              className={`py-2 border-b-2 ${
                active ? "border-signal text-ink-1" : "border-transparent text-ink-3"
              }`}
            >
              {t}
            </span>
          );
        })}
      </div>

      {/* App row with sparkline */}
      <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 overflow-hidden mb-4">
        <div className="grid grid-cols-[1fr_100px_100px_70px_80px] gap-3 px-3 py-2 border-b border-line-1 bg-surface-2 font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
          <span>App</span>
          <span>Path</span>
          <span>Buildpack</span>
          <span>14-day</span>
          <span>Status</span>
        </div>
        <div className="demo-app-row grid grid-cols-[1fr_100px_100px_70px_80px] gap-3 px-3 py-3 items-center text-[11.5px]">
          <span className="flex items-center gap-2 text-ink-1">
            <span className="h-5 w-5 rounded-[3px] bg-surface-3 grid place-items-center text-[9px] font-mono text-signal">
              A
            </span>
            orbit-api
          </span>
          <span className="font-mono text-[10.5px] text-ink-2">services/api</span>
          <span className="font-mono text-[10.5px] text-ink-2">node · 22</span>
          <Sparkline values={[2, 4, 3, 5, 4, 7, 6, 8, 5, 9, 7, 10, 12, 9]} />
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-online" />
            <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-online">
              ready
            </span>
          </span>
        </div>
      </div>

      {/* Two-column dense detail */}
      <div className="grid grid-cols-1 sm:grid-cols-[1.1fr_1fr] gap-3">
        {/* Environments */}
        <div className="space-y-2">
          <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
            Environments
          </div>
          <EnvCard
            name="staging"
            branch="develop"
            host="orbit-api-staging.apps.orbit.co"
            version="v123"
            delay="0"
          />
          <EnvCard
            name="production"
            branch="main"
            host="orbit-api.apps.orbit.co"
            version="v122"
            delay="1"
          />
        </div>

        {/* Right column: env vars + domains */}
        <div className="space-y-3">
          <Panel title="Environment variables" icon={KeyRound}>
            <KvRow k="DATABASE_URL"      type="secret" />
            <KvRow k="REDIS_URL"         type="secret" />
            <KvRow k="LOG_LEVEL"         type="string" v="info" />
            <KvRow k="PUBLIC_BASE_URL"   type="url"    v="https://orbit-api.apps.orbit.co" />
          </Panel>
          <Panel title="Domains" icon={Globe}>
            <DomainRow host="orbit-api.apps.orbit.co" tls="issued" />
            <DomainRow host="api.orbit.co"            tls="issued" />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function EnvCard({
  name,
  branch,
  host,
  version,
  delay,
}: {
  name: string;
  branch: string;
  host: string;
  version: string;
  delay: "0" | "1";
}) {
  return (
    <div
      className={`demo-env-card demo-env-card-${delay} rounded-[var(--radius)] border border-line-1 bg-surface-1 p-3`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-ink-1 text-[12px] font-medium">{name}</span>
        <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
          <GitBranch className="h-2.5 w-2.5" />
          {branch}
        </span>
      </div>
      <div className="font-mono text-[10px] text-ink-3 truncate mb-2">{host}</div>
      <div className="flex items-center justify-between pt-2 border-t border-line-1">
        <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-online inline-flex items-center gap-1.5">
          <span className="h-1 w-1 rounded-full bg-online" />
          live
        </span>
        <span className="font-mono text-[10px] text-ink-2">{version}</span>
      </div>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line-1 bg-surface-2">
        <Icon className="h-3 w-3 text-signal" />
        <span className="font-mono uppercase tracking-[0.14em] text-[9px] text-ink-3">
          {title}
        </span>
      </div>
      <ul className="divide-y divide-line-1">{children}</ul>
    </div>
  );
}

function KvRow({
  k,
  type,
  v,
}: {
  k: string;
  type: "secret" | "string" | "url";
  v?: string;
}) {
  const typeCls =
    type === "secret"
      ? "text-alert border-[color-mix(in_oklch,var(--alert)_30%,transparent)]"
      : type === "url"
        ? "text-info border-[color-mix(in_oklch,var(--info)_30%,transparent)]"
        : "text-ink-3 border-line-1";
  return (
    <li className="grid grid-cols-[1fr_auto] gap-2 items-center px-3 py-1.5 text-[10.5px]">
      <span className="font-mono text-ink-1 truncate">{k}</span>
      <span className="flex items-center gap-1.5">
        {v && <span className="font-mono text-ink-3 truncate max-w-[140px]">{v}</span>}
        <span
          className={`inline-block px-1.5 py-px rounded-[3px] border font-mono uppercase tracking-[0.14em] text-[8.5px] ${typeCls}`}
        >
          {type === "secret" ? "•••" : type}
        </span>
      </span>
    </li>
  );
}

function DomainRow({ host, tls }: { host: string; tls: "issued" }) {
  return (
    <li className="flex items-center justify-between px-3 py-1.5 text-[10.5px]">
      <span className="font-mono text-ink-1 truncate">{host}</span>
      <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.14em] text-[9px] text-online">
        <span className="h-1 w-1 rounded-full bg-online" />
        {tls}
      </span>
    </li>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 60},${24 - (v / max) * 18 - 3}`)
    .join(" ");
  return (
    <svg viewBox="0 0 60 24" className="h-5 w-full" preserveAspectRatio="none">
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
