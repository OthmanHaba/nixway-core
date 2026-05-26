"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Plus, Trash2 } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Badge } from "@/components/primitives/Badge";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Alert } from "@/components/primitives/Alert";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { AddMemberDialog } from "./AddMemberDialog";
import { clusterMembersApi, ApiError } from "@/lib/api";
import type { ClusterMember, Server } from "@/lib/types";

interface Props {
  teamId: string;
  clusterId: string;
  initialMembers: ClusterMember[];
  allServers: Server[];
}

export function MembersClient({
  teamId,
  clusterId,
  initialMembers,
  allServers,
}: Props) {
  const queryClient = useQueryClient();

  const members = useQuery({
    queryKey: ["cluster-members", clusterId],
    queryFn: () => clusterMembersApi.list(teamId, clusterId),
    initialData: initialMembers,
  });

  const remove = useMutation({
    mutationFn: ({ serverId }: { serverId: string }) =>
      clusterMembersApi.remove(teamId, clusterId, serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["cluster-members", clusterId],
      });
      queryClient.invalidateQueries({ queryKey: ["cluster-mesh", clusterId] });
    },
  });

  const list = members.data ?? [];
  const memberServerIds = new Set(list.map((m) => m.server_id));
  const candidates = allServers.filter((s) => !memberServerIds.has(s.id));

  const serverNameById = new Map(allServers.map((s) => [s.id, s] as const));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="label-mono mb-1">Roster</div>
          <p className="text-[13px] text-ink-3 max-w-md">
            Members peer with every other member to form a full WireGuard mesh.
            Adding or removing a member pushes a fresh peer config to every
            agent in the cluster.
          </p>
        </div>
        <AddMemberDialog
          teamId={teamId}
          clusterId={clusterId}
          candidates={candidates}
          trigger={
            <Button>
              <Plus className="h-3.5 w-3.5" /> Add server
            </Button>
          }
        />
      </div>

      {remove.error && (
        <Alert tone="error">{mutationErrorMessage(remove.error)}</Alert>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={<Cpu className="h-4 w-4" />}
          title="No members yet"
          body="Add a server to bootstrap the mesh. The first member becomes the seed peer; subsequent additions join automatically."
          action={
            <AddMemberDialog
              teamId={teamId}
              clusterId={clusterId}
              candidates={candidates}
              trigger={
                <Button>
                  <Plus className="h-3.5 w-3.5" /> Add server
                </Button>
              }
            />
          }
        />
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Server</TH>
                <TH>WireGuard IP</TH>
                <TH>Status</TH>
                <TH>Joined</TH>
                <TH align="right" className="w-12">
                  {" "}
                </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((m) => {
                const srv = serverNameById.get(m.server_id);
                const name =
                  m.server_name || srv?.name || m.server_id.slice(0, 8);
                const hostname = m.server_hostname || srv?.hostname;
                return (
                  <TR key={m.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <div className="h-7 w-7 grid place-items-center rounded-[3px] bg-surface-2 border border-line-1 text-ink-3">
                          <Cpu className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] text-ink-1 truncate">
                            {name}
                          </div>
                          {hostname && (
                            <div className="font-mono text-[11px] text-ink-3 truncate">
                              {hostname}
                            </div>
                          )}
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <span className="font-mono text-[12px] text-ink-1 num">
                        {m.wireguard_ip}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(m.status)} dot>
                        {m.status}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3 num">
                        {formatDate(m.created_at)}
                      </span>
                    </TD>
                    <TD align="right">
                      <ConfirmDialog
                        destructive
                        title="Remove from cluster?"
                        description={
                          <>
                            <span className="text-ink-1">{name}</span> will
                            leave the WireGuard mesh. Other members lose their
                            peer entry to it; the server itself stays registered
                            in the team.
                          </>
                        }
                        confirmLabel="Remove from cluster"
                        onConfirm={() =>
                          new Promise<void>((resolve, reject) =>
                            remove.mutate(
                              { serverId: m.server_id },
                              {
                                onSuccess: () => resolve(),
                                onError: (e) => reject(e),
                              },
                            ),
                          )
                        }
                        trigger={
                          <button
                            type="button"
                            disabled={remove.isPending}
                            className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-alert hover:bg-surface-2 transition-colors disabled:opacity-50"
                            aria-label={`Remove ${name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        }
                      />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function statusTone(status: string): "online" | "warn" | "alert" | "neutral" {
  const s = status?.toLowerCase() ?? "-x";
  if (["active", "ready", "online", "healthy"].includes(s)) return "online";
  if (["pending", "provisioning", "joining"].includes(s)) return "warn";
  if (["error", "offline", "failed"].includes(s)) return "alert";
  return "neutral";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function mutationErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Mutation failed.";
}
