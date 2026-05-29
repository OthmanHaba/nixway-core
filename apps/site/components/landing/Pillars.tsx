import { GitBranch, Network, ShieldCheck, Terminal, Database, Gauge } from "lucide-react";

/* Asymmetric bento — 1 hero tile + 2 stacked tiles. No 3-equal-cards. */
export function Pillars() {
  return (
    <section className="border-b border-line-1 bg-surface-0">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-10 py-24">
        <div className="max-w-2xl">
          <div className="label-mono mb-3">Why teams switch</div>
          <h2 className="font-display italic text-4xl sm:text-5xl text-ink-1 leading-[1.05]">
            Heroku-grade UX on infrastructure you control.
          </h2>
          <p className="mt-4 text-ink-2 text-[15px] leading-relaxed max-w-xl">
            One control plane. One CLI. One console. Every workload, every
            region, every server you operate, on one pane of glass.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Hero tile spans 2 cols */}
          <div className="md:col-span-2 rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 p-8 relative overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.15] pointer-events-none scanlines"
            />
            <div className="relative">
              <div className="flex items-center gap-2 text-signal mb-4">
                <GitBranch className="h-4 w-4" />
                <span className="font-mono uppercase tracking-[0.14em] text-[11px]">
                  Git-native deploys
                </span>
              </div>
              <h3 className="font-display italic text-3xl text-ink-1 leading-tight">
                Push the branch. Nixway does the rest.
              </h3>
              <p className="mt-3 text-ink-2 text-[14px] leading-relaxed max-w-[55ch]">
                Connect a GitHub repo, pick a branch, and Nixway provisions a
                build pipeline, an internal registry, a service mesh route,
                automatic TLS, health checks, and rollback. Zero YAML required.
                Promote to staging or production with a single command.
              </p>
              <dl className="mt-6 grid grid-cols-3 gap-6 max-w-md">
                <Stat n="38s" l="median deploy" />
                <Stat n="0 YAML" l="to first deploy" />
                <Stat n="1-click" l="rollback to prior" />
              </dl>
            </div>
          </div>

          {/* Two stacked tiles */}
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 p-7">
            <Network className="h-4 w-4 text-signal mb-4" />
            <h3 className="text-ink-1 text-[15px] font-medium mb-1.5">
              Private mesh across regions
            </h3>
            <p className="text-ink-3 text-[13px] leading-relaxed">
              Servers in different clouds join a private overlay. Services talk
              over internal DNS like they share a rack, encrypted end-to-end.
            </p>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 p-7">
            <ShieldCheck className="h-4 w-4 text-signal mb-4" />
            <h3 className="text-ink-1 text-[15px] font-medium mb-1.5">
              Secrets, audit, RBAC
            </h3>
            <p className="text-ink-3 text-[13px] leading-relaxed">
              Reveal-once secrets, per-team roles, and an append-only audit log
              of every action. The compliance story is already written.
            </p>
          </div>
        </div>

        {/* Secondary row: 3 plain rows of capability, hairlines not cards */}
        <div className="mt-10 border-t border-line-1 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-line-1">
          <Row icon={Terminal} title="Exec into anything" body="Web terminal, log search, syslog drain. No SSH required." />
          <Row icon={Database} title="Managed Postgres" body="Provision a replica, take a backup, run a query, ship a migration." />
          <Row icon={Gauge} title="Built-in telemetry" body="VictoriaMetrics under the hood. Dashboards on day one." />
        </div>
      </div>
    </section>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <div className="font-mono text-[1.75rem] text-ink-1 num leading-none">{n}</div>
      <div className="mt-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-ink-3">
        {l}
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="px-6 py-7">
      <Icon className="h-4 w-4 text-ink-3 mb-3" />
      <div className="text-ink-1 text-[14px] font-medium mb-1">{title}</div>
      <p className="text-ink-3 text-[12.5px] leading-relaxed">{body}</p>
    </div>
  );
}
