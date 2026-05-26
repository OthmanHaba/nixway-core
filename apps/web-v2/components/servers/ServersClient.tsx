"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Server as ServerIcon, Cpu, ChevronRight } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { ServerStatusBadge } from "./ServerStatusBadge";
import { RegisterServerDialog } from "./RegisterServerDialog";
import { serversApi } from "@/lib/api";
import type { Server, SshKey } from "@/lib/types";

export function ServersClient({
  teamId,
  initialServers,
  sshKeys,
}: {
  teamId: string;
  initialServers: Server[];
  sshKeys: SshKey[];
}) {
  const servers = useQuery({
    queryKey: ["servers", teamId],
    queryFn: () => serversApi.list(teamId),
    initialData: initialServers,
  });

  const list = servers.data ?? [];

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<ServerIcon className="h-4 w-4" />}
        title="No servers in the fleet"
        body="Register a server to start deploying workloads. The agent installs over SSH and reports back over an outbound tunnel."
        action={
          <RegisterServerDialog
            teamId={teamId}
            sshKeys={sshKeys}
            trigger={
              <Button>
                <Plus className="h-3.5 w-3.5" /> Register server
              </Button>
            }
          />
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          {list.length} {list.length === 1 ? "server" : "servers"}
        </div>
        <RegisterServerDialog
          teamId={teamId}
          sshKeys={sshKeys}
          trigger={
            <Button>
              <Plus className="h-3.5 w-3.5" /> Register server
            </Button>
          }
        />
      </div>

      <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>Server</TH>
              <TH>Status</TH>
              <TH>Public IP</TH>
              <TH>OS</TH>
              <TH>Last seen</TH>
              <TH align="right" className="w-8"> </TH>
            </TR>
          </THead>
          <TBody>
            {list.map((s) => (
              <TR key={s.id} className="cursor-pointer">
                <TD>
                  <Link href={`/servers/${s.id}`} className="block">
                    <div className="flex items-center gap-3">
                      <div className="h-7 w-7 grid place-items-center rounded-[3px] bg-surface-2 border border-line-1 text-ink-3">
                        <Cpu className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] text-ink-1 truncate">{s.name}</div>
                        <div className="font-mono text-[11px] text-ink-3 truncate">{s.hostname}</div>
                      </div>
                    </div>
                  </Link>
                </TD>
                <TD>
                  <ServerStatusBadge status={s.status} />
                </TD>
                <TD>
                  <span className="font-mono text-[12px] text-ink-2 num">{s.public_ip}</span>
                </TD>
                <TD>
                  {s.os ? (
                    <span className="font-mono text-[11px] text-ink-2">
                      {s.os}
                      {s.os_version && <span className="text-ink-3"> · {s.os_version}</span>}
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-ink-4">—</span>
                  )}
                </TD>
                <TD>
                  <span className="font-mono text-[11px] text-ink-3 num">
                    {s.last_seen_at ? formatRelative(s.last_seen_at) : "never"}
                  </span>
                </TD>
                <TD align="right">
                  <Link
                    href={`/servers/${s.id}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                    aria-label="View server"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60)  return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)  return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)   return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7)   return `${day}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
