"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, UserPlus, Trash2, Mail } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Avatar } from "@/components/primitives/Avatar";
import { Badge } from "@/components/primitives/Badge";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Alert } from "@/components/primitives/Alert";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/primitives/DropdownMenu";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { membersApi, invitesApi, ApiError } from "@/lib/api";
import type { TeamMember, TeamInvite, Role } from "@/lib/types";

interface MembersClientProps {
  teamId: string;
  currentUserId: string;
  initialMembers: TeamMember[];
  initialInvites: TeamInvite[];
}

const ROLE_TONE: Record<Role, "signal" | "info" | "neutral"> = {
  owner:  "signal",
  admin:  "info",
  member: "neutral",
};

export function MembersClient({
  teamId,
  currentUserId,
  initialMembers,
  initialInvites,
}: MembersClientProps) {
  const queryClient = useQueryClient();

  const members = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => membersApi.list(teamId),
    initialData: initialMembers,
  });

  const invites = useQuery({
    queryKey: ["team-invites", teamId],
    queryFn: () => invitesApi.list(teamId),
    initialData: initialInvites,
  });

  const currentMember = members.data?.find((m) => m.user_id === currentUserId);
  const canManage = currentMember?.role === "owner" || currentMember?.role === "admin";
  const canChangeRoles = currentMember?.role === "owner";

  const removeMember = useMutation({
    mutationFn: ({ userId }: { userId: string }) => membersApi.remove(teamId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team-members", teamId] }),
  });

  const updateRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      membersApi.updateRole(teamId, userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team-members", teamId] }),
  });

  const cancelInvite = useMutation({
    mutationFn: ({ inviteId }: { inviteId: string }) => invitesApi.cancel(teamId, inviteId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team-invites", teamId] }),
  });

  const list = members.data ?? [];
  const pending = invites.data ?? [];

  return (
    <div className="space-y-8">
      {/* toolbar */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="label-mono mb-1">Roster</div>
          <p className="text-[13px] text-ink-3 max-w-md">
            Members can view the team&rsquo;s resources. Admins manage members and infra.
            Owners control everything, including team deletion.
          </p>
        </div>
        {canManage && (
          <InviteMemberDialog
            teamId={teamId}
            trigger={
              <Button>
                <UserPlus className="h-3.5 w-3.5" /> Invite member
              </Button>
            }
          />
        )}
      </div>

      {(removeMember.error || updateRole.error || cancelInvite.error) && (
        <Alert tone="error">
          {mutationErrorMessage(removeMember.error ?? updateRole.error ?? cancelInvite.error)}
        </Alert>
      )}

      {/* members table */}
      {list.length === 0 ? (
        <EmptyState
          icon={<UserPlus className="h-4 w-4" />}
          title="No members"
          body="This shouldn't happen — every team has at least one owner."
        />
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Operator</TH>
                <TH>Role</TH>
                <TH>Joined</TH>
                <TH align="right" className="w-12"> </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((member) => {
                const isSelf = member.user_id === currentUserId;
                const isOwner = member.role === "owner";
                return (
                  <TR key={member.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={member.user_name || member.email} seed={member.user_id} size="sm" />
                        <div className="min-w-0">
                          <div className="text-[13px] text-ink-1 truncate flex items-center gap-2">
                            {member.user_name || member.email}
                            {isSelf && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">you</span>}
                          </div>
                          <div className="font-mono text-[11px] text-ink-3 truncate">{member.email}</div>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={ROLE_TONE[member.role]} dot>
                        {member.role}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3 num">{formatDate(member.created_at)}</span>
                    </TD>
                    <TD align="right">
                      {canManage && !isSelf && !isOwner && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                              aria-label="Member actions"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel>{member.email}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {canChangeRoles && (
                              <>
                                {(["admin", "member"] as const).map((r) =>
                                  member.role !== r ? (
                                    <DropdownMenuItem
                                      key={r}
                                      disabled={updateRole.isPending}
                                      onSelect={() => updateRole.mutate({ userId: member.user_id, role: r })}
                                    >
                                      <span className="capitalize">Make {r}</span>
                                    </DropdownMenuItem>
                                  ) : null,
                                )}
                                <DropdownMenuSeparator />
                              </>
                            )}
                            <ConfirmDialog
                              destructive
                              title="Remove member?"
                              description={
                                <>
                                  This removes <span className="text-ink-1">{member.user_name || member.email}</span> from the team
                                  immediately. They lose access to all team resources.
                                </>
                              }
                              confirmLabel="Remove member"
                              onConfirm={() =>
                                new Promise<void>((resolve, reject) =>
                                  removeMember.mutate(
                                    { userId: member.user_id },
                                    { onSuccess: () => resolve(), onError: (e) => reject(e) },
                                  ),
                                )
                              }
                              trigger={
                                <DropdownMenuItem
                                  disabled={removeMember.isPending}
                                  onSelect={(e) => e.preventDefault()}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-alert" />
                                  <span className="text-alert">Remove</span>
                                </DropdownMenuItem>
                              }
                            />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}

      {/* pending invites */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <div className="label-mono">Pending invites</div>
              <p className="text-[12px] text-ink-3 mt-1">Awaiting acceptance. Each invite expires after seven days.</p>
            </div>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Sent</TH>
                  <TH>Expires</TH>
                  <TH align="right" className="w-12"> </TH>
                </TR>
              </THead>
              <TBody>
                {pending.map((inv) => (
                  <TR key={inv.id}>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <Mail className="h-3.5 w-3.5 text-ink-3" />
                        <span className="font-mono text-[12px] text-ink-1">{inv.email}</span>
                      </div>
                    </TD>
                    <TD><Badge tone={ROLE_TONE[inv.role]}>{inv.role}</Badge></TD>
                    <TD><span className="font-mono text-[11px] text-ink-3 num">{formatDate(inv.created_at)}</span></TD>
                    <TD><span className="font-mono text-[11px] text-ink-3 num">{formatDate(inv.expires_at)}</span></TD>
                    <TD align="right">
                      {canManage && (
                        <ConfirmDialog
                          destructive
                          title="Cancel invite?"
                          description={
                            <>
                              The link sent to <span className="text-ink-1">{inv.email}</span> will stop working.
                              You can issue a new one anytime.
                            </>
                          }
                          confirmLabel="Cancel invite"
                          onConfirm={() =>
                            new Promise<void>((resolve, reject) =>
                              cancelInvite.mutate(
                                { inviteId: inv.id },
                                { onSuccess: () => resolve(), onError: (e) => reject(e) },
                              ),
                            )
                          }
                          trigger={
                            <button
                              type="button"
                              disabled={cancelInvite.isPending}
                              className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-alert hover:bg-surface-2 transition-colors disabled:opacity-50"
                              aria-label="Cancel invite"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          }
                        />
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
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
