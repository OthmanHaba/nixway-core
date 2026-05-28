"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, KeyRound, MoreHorizontal, Trash2 } from "lucide-react";
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
import { CreateTokenDialog } from "./CreateTokenDialog";
import { tokensApi, ApiError } from "@/lib/api";
import type { ApiToken } from "@/lib/types";

export function TokensClient({
  teamId,
  initialTokens,
}: {
  teamId: string;
  initialTokens: ApiToken[];
}) {
  const queryClient = useQueryClient();

  const tokens = useQuery({
    queryKey: ["team-tokens", teamId],
    queryFn: () => tokensApi.list(teamId),
    initialData: initialTokens,
  });

  const revoke = useMutation({
    mutationFn: ({ tokenId }: { tokenId: string }) => tokensApi.revoke(teamId, tokenId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team-tokens", teamId] }),
  });

  const list = tokens.data ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="label-mono mb-1">Bearer tokens</div>
          <p className="text-[13px] text-ink-3 max-w-md">
            Tokens authenticate machine clients (CI, scripts, integrations). Each has its own scope
            set and we only ever store the hash — values are shown one time at creation.
          </p>
        </div>
        <CreateTokenDialog
          teamId={teamId}
          trigger={
            <Button>
              <Plus className="h-3.5 w-3.5" /> New token
            </Button>
          }
        />
      </div>

      {revoke.error && (
        <Alert tone="error">{mutationErrorMessage(revoke.error)}</Alert>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-4 w-4" />}
          title="No API tokens yet"
          body="Issue a token to call the Nixway API from CI pipelines, infrastructure tooling, or scripts."
          action={
            <CreateTokenDialog
              teamId={teamId}
              trigger={
                <Button>
                  <Plus className="h-3.5 w-3.5" /> New token
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
                <TH>Scopes</TH>
                <TH>Last used</TH>
                <TH>Expires</TH>
                <TH>Created</TH>
                <TH align="right" className="w-12"> </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((token) => (
                <TR key={token.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <KeyRound className="h-3.5 w-3.5 text-ink-3" />
                      <span className="text-[13px] text-ink-1">{token.name}</span>
                    </div>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1 max-w-[280px]">
                      {token.scopes.slice(0, 4).map((s) => (
                        <Badge key={s} tone={s === "*" ? "signal" : "outline"}>{s}</Badge>
                      ))}
                      {token.scopes.length > 4 && (
                        <Badge tone="outline">+{token.scopes.length - 4}</Badge>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-3 num">
                      {token.last_used_at ? formatDate(token.last_used_at) : "never"}
                    </span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] num">
                      {token.expires_at ? (
                        isExpired(token.expires_at) ? (
                          <span className="text-alert">expired</span>
                        ) : (
                          <span className="text-ink-3">{formatDate(token.expires_at)}</span>
                        )
                      ) : (
                        <span className="text-ink-3">never</span>
                      )}
                    </span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-3 num">{formatDate(token.created_at)}</span>
                  </TD>
                  <TD align="right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                          aria-label="Token actions"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>{token.name}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <ConfirmDialog
                          destructive
                          title="Revoke token?"
                          description={
                            <>
                              The token <span className="text-ink-1">{token.name}</span> stops working immediately.
                              Any client using it will see 401 responses on the next request.
                            </>
                          }
                          confirmLabel="Revoke token"
                          onConfirm={() =>
                            new Promise<void>((resolve, reject) =>
                              revoke.mutate(
                                { tokenId: token.id },
                                { onSuccess: () => resolve(), onError: (e) => reject(e) },
                              ),
                            )
                          }
                          trigger={
                            <DropdownMenuItem
                              disabled={revoke.isPending}
                              onSelect={(e) => e.preventDefault()}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-alert" />
                              <span className="text-alert">Revoke</span>
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

function isExpired(iso: string): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

function mutationErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Mutation failed.";
}
