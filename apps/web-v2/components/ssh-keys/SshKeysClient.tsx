"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, MoreHorizontal, Trash2 } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/primitives/DropdownMenu";
import { GenerateSshKeyDialog } from "./GenerateSshKeyDialog";
import { sshKeysApi, ApiError } from "@/lib/api";
import type { SshKey } from "@/lib/types";

export function SshKeysClient({
  teamId,
  initialKeys,
}: {
  teamId: string;
  initialKeys: SshKey[];
}) {
  const queryClient = useQueryClient();

  const keys = useQuery({
    queryKey: ["ssh-keys", teamId],
    queryFn: () => sshKeysApi.list(teamId),
    initialData: initialKeys,
  });

  const remove = useMutation({
    mutationFn: ({ keyId }: { keyId: string }) => sshKeysApi.remove(teamId, keyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ssh-keys", teamId] }),
  });

  const list = keys.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="label-mono mb-1">Keypairs</div>
          <p className="text-[13px] text-ink-3 max-w-md">
            SSH keys onboard servers and authenticate maintenance sessions. Generated keys
            have their private half encrypted on the platform and revealed once at creation.
          </p>
        </div>
        <GenerateSshKeyDialog
          teamId={teamId}
          trigger={
            <Button>
              <Plus className="h-3.5 w-3.5" /> Generate key
            </Button>
          }
        />
      </div>

      {remove.error && <Alert tone="error">{mutationErrorMessage(remove.error)}</Alert>}

      {list.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-4 w-4" />}
          title="No SSH keys yet"
          body="You need at least one key to onboard a server. Generate one now — the platform creates the pair and stores the private half encrypted."
          action={
            <GenerateSshKeyDialog
              teamId={teamId}
              trigger={
                <Button>
                  <Plus className="h-3.5 w-3.5" /> Generate key
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
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>Fingerprint</TH>
                <TH>Created</TH>
                <TH align="right" className="w-12"> </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((key) => (
                <TR key={key.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <KeyRound className="h-3.5 w-3.5 text-ink-3" />
                      <span className="text-[13px] text-ink-1">{key.name}</span>
                    </div>
                  </TD>
                  <TD>
                    <Badge tone="outline">{key.key_type}</Badge>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-3 break-all">
                      {key.fingerprint}
                    </span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-3 num">{formatDate(key.created_at)}</span>
                  </TD>
                  <TD align="right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                          aria-label="Key actions"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuLabel>{key.name}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <ConfirmDialog
                          destructive
                          title="Delete this SSH key?"
                          description={
                            <>
                              Removing <span className="text-ink-1">{key.name}</span> will prevent it from being used to
                              onboard new servers. Servers that already trust this key are unaffected, but
                              you&rsquo;ll lose the ability to rotate from this platform.
                            </>
                          }
                          confirmLabel="Delete key"
                          onConfirm={() =>
                            new Promise<void>((resolve, reject) =>
                              remove.mutate(
                                { keyId: key.id },
                                { onSuccess: () => resolve(), onError: (e) => reject(e) },
                              ),
                            )
                          }
                          trigger={
                            <DropdownMenuItem
                              disabled={remove.isPending}
                              onSelect={(e) => e.preventDefault()}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-alert" />
                              <span className="text-alert">Delete key</span>
                            </DropdownMenuItem>
                          }
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
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
