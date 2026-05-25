import Link from "next/link";
import { ArrowUpRight, Plus, Server as ServerIcon, Network, Boxes, Database as DbIcon } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getTeamContext } from "@/lib/team";
import { tryGet } from "@/lib/server-api";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { Separator } from "@/components/primitives/Separator";
import type { AuditLog, Cluster, Project, Server, ServerStatus } from "@/lib/types";

export const metadata = { title: "Overview · Nixway Core" };

export default async function DashboardPage() {
  const user = await requireUser();
  const { activeTeam } = await getTeamContext();
  const firstName = (user.name || user.email).split(/[\s@]+/)[0];

  if (!activeTeam) {
    return <NoTeamState firstName={firstName} />;
  }

  // Fetch in parallel. tryGet swallows errors so one broken endpoint doesn't
  // kill the whole page; instead the affected tile shows zero / placeholder.
  const [servers, clusters, projects, audit] = await Promise.all([
    tryGet<Server[]>(`/teams/${activeTeam.id}/servers`, []),
    tryGet<Cluster[]>(`/teams/${activeTeam.id}/clusters`, []),
    tryGet<Project[]>(`/teams/${activeTeam.id}/projects`, []),
    tryGet<AuditLog[]>(`/teams/${activeTeam.id}/audit-logs?limit=5`, []),
  ]);

  const serverBreak = breakdownByStatus(servers);

  return (
    <div className="px-6 sm:px-10 py-10 max-w-[1240px] mx-auto">
      {/* hero ──────────────────────────────────────────────────────── */}
      <div className="mb-10 reveal reveal-1">
        <div className="label-mono mb-3 flex items-center gap-3">
          <span>Console · overview</span>
          <span className="h-px flex-1 max-w-[180px] bg-line-1" />
          <span className="text-ink-3">{activeTeam.slug}</span>
        </div>
        <h1 className="font-display italic text-5xl sm:text-6xl text-ink-1 leading-none">
          Good to see you, {firstName}.
        </h1>
        <p className="mt-4 text-ink-2 max-w-xl">
          Mission control for <span className="text-ink-1">{activeTeam.name}</span>.
          Here&rsquo;s the state of the fleet.
        </p>
      </div>

      {/* stat row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10 reveal reveal-2">
        <StatTile
          icon={ServerIcon}
          label="Servers"
          value={servers.length}
          sub={`${serverBreak.online} online · ${serverBreak.degraded} drift · ${serverBreak.offline} offline`}
          tone={serverBreak.offline > 0 ? "warn" : "on"}
          href="/servers"
        />
        <StatTile
          icon={Network}
          label="Clusters"
          value={clusters.length}
          sub={`${clusters.filter((c) => c.status === "active").length} active`}
          tone="on"
          href="/clusters"
        />
        <StatTile
          icon={Boxes}
          label="Projects"
          value={projects.length}
          sub={projects.length === 0 ? "none yet" : "across active clusters"}
          tone="on"
          href="/projects"
        />
        <StatTile
          icon={DbIcon}
          label="Databases"
          value="—"
          sub="per-project · see Databases"
          tone="on"
          href="/databases"
        />
      </div>

      {/* status + activity ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-6 mb-10 reveal reveal-3">
        <FleetStatusCard servers={servers} />
        <RecentActivityCard entries={audit} />
      </div>

      {/* quick actions ─────────────────────────────────────────────── */}
      <div className="reveal reveal-4">
        <div className="label-mono mb-3">Quick actions</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <QuickAction
            href="/servers"
            title="Register a server"
            body="Add a bare-metal or cloud host to the fleet. Agent auto-installs over SSH."
          />
          <QuickAction
            href="/projects"
            title="Spin up a project"
            body="Define environments, wire a GitHub repo, and start shipping."
          />
          <QuickAction
            href="/teams"
            title="Invite an operator"
            body="Bring a teammate in. Roles: Owner, Admin, Member — fine-grained on next pass."
          />
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */

function NoTeamState({ firstName }: { firstName: string }) {
  return (
    <div className="px-6 sm:px-10 py-16 max-w-[760px] mx-auto">
      <div className="reveal reveal-1">
        <div className="label-mono mb-3">Console · provisioning</div>
        <h1 className="font-display italic text-5xl text-ink-1 leading-none">
          Welcome, {firstName}.
        </h1>
        <p className="mt-4 text-ink-2 max-w-md">
          You don&rsquo;t belong to a team yet. Create one to start registering
          servers, clusters, and projects.
        </p>
      </div>
      <Card className="mt-10 reveal reveal-2">
        <CardBody className="flex items-center gap-4 py-8">
          <div className="h-12 w-12 grid place-items-center rounded-[var(--radius)] bg-surface-2 text-signal">
            <Plus className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="text-ink-1">Create your first team</div>
            <div className="text-[12px] text-ink-3 mt-0.5">
              A team owns servers, projects, and members. Coming in the next phase.
            </div>
          </div>
          <span className="label-mono">soon</span>
        </CardBody>
      </Card>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  sub: string;
  tone: "on" | "warn" | "off";
  href: string;
}) {
  const dot = tone === "on" ? "bg-online" : tone === "warn" ? "bg-warn" : "bg-ink-4/40";
  return (
    <Link
      href={href}
      className="group block rounded-[var(--radius)] border border-line-1 bg-surface-1 p-4 hover:border-line-2 hover:bg-surface-2 transition-colors"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-ink-3 group-hover:text-ink-2 transition-colors" />
          <span className="label-mono">{label}</span>
        </div>
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-3xl text-ink-1 num leading-none">{value}</span>
      </div>
      <div className="mt-2 text-[11px] text-ink-3">{sub}</div>
      <div className="mt-3 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.14em] text-ink-4 group-hover:text-signal transition-colors">
        Drill in <ArrowUpRight className="h-3 w-3" />
      </div>
    </Link>
  );
}

function FleetStatusCard({ servers }: { servers: Server[] }) {
  const rows = STATUSES.map((s) => ({
    status: s.key,
    label: s.label,
    tone: s.tone,
    count: servers.filter((srv) => normalizeStatus(srv.status) === s.key).length,
  }));
  const total = servers.length || 1;

  return (
    <Card>
      <CardHeader>
        <div className="label-mono mb-1">Fleet status</div>
        <h2 className="text-[18px] text-ink-1">Server health</h2>
      </CardHeader>
      <CardBody>
        {servers.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-ink-3">
            No servers registered yet.
            <Link href="/servers" className="ml-2 text-signal hover:underline underline-offset-4">
              Add one →
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const pct = (r.count / total) * 100;
              return (
                <li key={r.status} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="flex items-center gap-2 text-ink-2">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotFor(r.tone)}`} />
                      {r.label}
                    </span>
                    <span className="font-mono text-ink-1 num">{r.count}</span>
                  </div>
                  <div className="h-[3px] rounded-full bg-surface-3 overflow-hidden">
                    <div
                      className={`${barFor(r.tone)} h-full transition-[width] duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function RecentActivityCard({ entries }: { entries: AuditLog[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <div className="label-mono mb-1">Telemetry</div>
            <h2 className="text-[18px] text-ink-1">Recent activity</h2>
          </div>
          <Link
            href="/activity"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 hover:text-signal transition-colors"
          >
            View all →
          </Link>
        </div>
      </CardHeader>
      <CardBody>
        {entries.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-ink-3">
            No audit events yet. Activity appears here as the team operates the platform.
          </div>
        ) : (
          <ul className="divide-y divide-line-1 -my-3">
            {entries.slice(0, 5).map((e) => (
              <li key={e.id} className="py-3 flex items-center gap-3">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-ink-1 truncate">
                    <span className="font-mono text-[12px]">{e.action}</span>
                    {e.resource_type && (
                      <span className="text-ink-3"> · {e.resource_type}</span>
                    )}
                  </span>
                  <span className="block text-[11px] text-ink-3 truncate">
                    {e.actor_name || e.actor_email || e.actor_type}
                  </span>
                </span>
                <time className="font-mono text-[10px] text-ink-4 shrink-0">
                  {formatRelative(e.created_at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function QuickAction({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="group block rounded-[var(--radius)] border border-line-1 bg-surface-1 p-5 hover:border-line-2 hover:bg-surface-2 transition-colors"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-[14px] text-ink-1 font-medium">{title}</h3>
        <ArrowUpRight className="h-3.5 w-3.5 text-ink-3 group-hover:text-signal transition-colors shrink-0" />
      </div>
      <p className="text-[12px] text-ink-3 leading-relaxed">{body}</p>
      <Separator className="my-4" />
      <span className="label-mono">Open →</span>
    </Link>
  );
}

/* ── helpers ────────────────────────────────────────────────────── */

const STATUSES: { key: ServerStatus; label: string; tone: "on" | "warn" | "off" }[] = [
  { key: "online",       label: "Online",       tone: "on"   },
  { key: "degraded",     label: "Degraded",     tone: "warn" },
  { key: "provisioning", label: "Provisioning", tone: "warn" },
  { key: "offline",      label: "Offline",      tone: "off"  },
  { key: "unknown",      label: "Unknown",      tone: "off"  },
];

function normalizeStatus(s: string): ServerStatus {
  const known: ServerStatus[] = ["online", "offline", "degraded", "provisioning", "unknown"];
  return (known as string[]).includes(s) ? (s as ServerStatus) : "unknown";
}

function breakdownByStatus(servers: Server[]) {
  return {
    online:   servers.filter((s) => normalizeStatus(s.status) === "online").length,
    degraded: servers.filter((s) => ["degraded", "provisioning"].includes(normalizeStatus(s.status))).length,
    offline:  servers.filter((s) => ["offline", "unknown"].includes(normalizeStatus(s.status))).length,
  };
}

function dotFor(tone: "on" | "warn" | "off") {
  return tone === "on" ? "bg-online" : tone === "warn" ? "bg-warn" : "bg-alert";
}
function barFor(tone: "on" | "warn" | "off") {
  return tone === "on" ? "bg-online" : tone === "warn" ? "bg-warn" : "bg-alert";
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60)        return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)        return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)         return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7)         return `${day}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
