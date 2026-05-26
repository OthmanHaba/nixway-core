import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, Globe, KeyRound } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { ServerStatusBadge } from "./ServerStatusBadge";
import type { ServerDetail, Team } from "@/lib/types";

export function ServerOverview({ server, team }: { server: ServerDetail; team: Team }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* connection ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Globe className="h-3 w-3" /> Connection
          </div>
          <h2 className="text-[16px] text-ink-1">SSH access</h2>
        </CardHeader>
        <CardBody className="space-y-3 text-[12px]">
          <Row label="Hostname"><span className="font-mono text-ink-1">{server.hostname}</span></Row>
          <Row label="Public IP"><span className="font-mono text-ink-1 num">{server.public_ip}</span></Row>
          <Row label="SSH user"><span className="font-mono text-ink-1">{server.ssh_user}</span></Row>
          <Row label="SSH port"><span className="font-mono text-ink-1 num">{server.ssh_port}</span></Row>
        </CardBody>
      </Card>

      {/* heartbeat ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Activity className="h-3 w-3" /> Heartbeat
          </div>
          <h2 className="text-[16px] text-ink-1">Agent telemetry</h2>
        </CardHeader>
        <CardBody className="space-y-3 text-[12px]">
          <Row label="Status"><ServerStatusBadge status={server.status} /></Row>
          <Row label="Agent ID">
            <span className="font-mono text-[11px] text-ink-2 break-all">
              {server.agent_id ?? <span className="text-ink-4">unset</span>}
            </span>
          </Row>
          <Row label="Last seen">
            <span className="font-mono text-ink-1 num">
              {server.last_seen_at ? formatRelative(server.last_seen_at) : "never"}
            </span>
          </Row>
          <Row label="Registered">
            <span className="font-mono text-ink-1 num">{formatDate(server.created_at)}</span>
          </Row>
        </CardBody>
      </Card>

      {/* platform ───────────────────────────────────────────────── */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <KeyRound className="h-3 w-3" /> Platform
          </div>
          <h2 className="text-[16px] text-ink-1">Operating environment</h2>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 text-[12px]">
            <Stat label="OS">{server.os ?? "—"}</Stat>
            <Stat label="OS version">{server.os_version ?? "—"}</Stat>
            <Stat label="Architecture">{server.arch ?? "—"}</Stat>
            <Stat label="Kernel">{server.resources?.kernel_version ?? "—"}</Stat>
          </dl>
          <div className="mt-6 pt-4 border-t border-line-1">
            <Link
              href={`/teams/${team.id}/audit-log?resource_type=server&resource_id=${server.id}`}
              className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 hover:text-signal transition-colors"
            >
              Audit history for this server →
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="label-mono">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="label-mono">{label}</div>
      <div className="font-mono text-[12px] text-ink-1">{children}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
