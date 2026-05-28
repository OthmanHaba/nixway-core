"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, KeySquare, MoreHorizontal, Plus, RotateCw, Trash2 } from "lucide-react";
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
import { CreateSecretDialog } from "./CreateSecretDialog";
import { RotateSecretDialog } from "./RotateSecretDialog";
import { RevealSecretDialog } from "./RevealSecretDialog";
import { secretsApi, ApiError } from "@/lib/api";
import type { Secret } from "@/lib/types";
import { cn } from "@/lib/cn";

const COMMON_ENVS = ["production", "staging", "preview", "development"];

interface Props {
  teamId: string;
  initialSecrets: Secret[];
}

export function SecretsClient({ teamId, initialSecrets }: Props) {
  const queryClient = useQueryClient();
  const [envFilter, setEnvFilter] = useState<string>("");

  const secrets = useQuery({
    queryKey: ["team-secrets", teamId, envFilter || "(all)"],
    queryFn: () => secretsApi.list(teamId, envFilter || undefined),
    initialData: envFilter ? undefined : initialSecrets,
  });

  const remove = useMutation({
    mutationFn: ({ secretId }: { secretId: string }) => secretsApi.remove(teamId, secretId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team-secrets", teamId] }),
  });

  const list = secrets.data ?? [];

  // Build the env chip list from common names + whatever envs the team uses.
  const envOptions = useMemo(() => {
    const seen = new Set<string>(COMMON_ENVS);
    for (const s of secrets.data ?? []) seen.add(s.environment);
    return Array.from(seen);
  }, [secrets.data]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="label-mono mb-1">Encrypted store</div>
          <p className="text-[13px] text-ink-3 max-w-md">
            Team-scoped secrets, partitioned by environment. Apps receive the matching env&rsquo;s
            secrets as environment variables at deploy time.
          </p>
        </div>
        <CreateSecretDialog
          teamId={teamId}
          defaultEnvironment={envFilter || undefined}
          trigger={
            <Button>
              <Plus className="h-3.5 w-3.5" /> Add secret
            </Button>
          }
        />
      </div>

      {/* env filter strip */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label-mono mr-2">Environment</span>
        <FilterChip
          label="All"
          active={envFilter === ""}
          onClick={() => setEnvFilter("")}
        />
        {envOptions.map((env) => (
          <FilterChip
            key={env}
            label={env}
            active={envFilter === env}
            onClick={() => setEnvFilter(env)}
          />
        ))}
      </div>

      {remove.error && (
        <Alert tone="error">{mutationErrorMessage(remove.error)}</Alert>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={<KeySquare className="h-4 w-4" />}
          title={envFilter ? `No secrets in ${envFilter}` : "No secrets yet"}
          body="Add a secret for this environment. We encrypt the value at rest and only release it via a one-time reveal."
          action={
            <CreateSecretDialog
              teamId={teamId}
              defaultEnvironment={envFilter || undefined}
              trigger={
                <Button>
                  <Plus className="h-3.5 w-3.5" /> Add secret
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
                <TH>Key</TH>
                <TH>Environment</TH>
                <TH>Version</TH>
                <TH>Revealed</TH>
                <TH>Created</TH>
                <TH align="right" className="w-12"> </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((s) => {
                const alreadyRevealed = !!s.revealed_at;
                return (
                  <TR key={s.id}>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <KeySquare className="h-3.5 w-3.5 text-ink-3" />
                        <span className="font-mono text-[12px] text-ink-1">{s.key}</span>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={s.environment === "production" ? "signal" : "outline"}>
                        {s.environment}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="font-mono text-[12px] text-ink-1 num">v{s.version}</span>
                    </TD>
                    <TD>
                      {alreadyRevealed ? (
                        <Badge tone="warn" dot>Revealed</Badge>
                      ) : (
                        <Badge tone="neutral">Sealed</Badge>
                      )}
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3 num">{formatDate(s.created_at)}</span>
                    </TD>
                    <TD align="right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                            aria-label="Secret actions"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuLabel>{s.key}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <RevealSecretDialog
                            teamId={teamId}
                            secret={s}
                            trigger={
                              <DropdownMenuItem
                                onSelect={(e) => e.preventDefault()}
                                disabled={alreadyRevealed}
                              >
                                <Eye className="h-3.5 w-3.5 text-ink-3" />
                                Reveal value
                                {alreadyRevealed && (
                                  <span className="ml-auto font-mono text-[10px] text-ink-4">used</span>
                                )}
                              </DropdownMenuItem>
                            }
                          />
                          <RotateSecretDialog
                            teamId={teamId}
                            secret={s}
                            trigger={
                              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                <RotateCw className="h-3.5 w-3.5 text-ink-3" />
                                Rotate value
                              </DropdownMenuItem>
                            }
                          />
                          <DropdownMenuSeparator />
                          <ConfirmDialog
                            destructive
                            title="Delete this secret?"
                            description={
                              <>
                                Removes <span className="text-ink-1">{s.key}</span> from{" "}
                                <span className="text-ink-1">{s.environment}</span>. Apps that
                                reference it stop receiving the value on their next deployment.
                              </>
                            }
                            confirmLabel="Delete secret"
                            onConfirm={() =>
                              new Promise<void>((resolve, reject) =>
                                remove.mutate(
                                  { secretId: s.id },
                                  { onSuccess: () => resolve(), onError: (e) => reject(e) },
                                ),
                              )
                            }
                            trigger={
                              <DropdownMenuItem
                                onSelect={(e) => e.preventDefault()}
                                disabled={remove.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-alert" />
                                <span className="text-alert">Delete</span>
                              </DropdownMenuItem>
                            }
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
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

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "font-mono uppercase tracking-[0.14em] text-[10px] px-2 py-0.5 rounded-[3px] border transition-colors",
        active
          ? "border-signal text-[color:var(--signal-ink)] bg-[color:var(--signal-soft)]"
          : "border-line-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1",
      )}
    >
      {label}
    </button>
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
