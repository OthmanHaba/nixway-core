"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag, Trash2 } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Alert } from "@/components/primitives/Alert";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { tagsApi, ApiError } from "@/lib/api";
import type { ServerTag } from "@/lib/types";

interface Props {
  teamId: string;
  serverId: string;
  initialTags: ServerTag[];
}

export function TagsClient({ teamId, serverId, initialTags }: Props) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const tags = useQuery({
    queryKey: ["server-tags", teamId, serverId],
    queryFn: () => tagsApi.list(teamId, serverId),
    initialData: initialTags,
  });

  const set = useMutation({
    mutationFn: ({ k, v }: { k: string; v: string }) => tagsApi.set(teamId, serverId, k, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server-tags", teamId, serverId] });
      setKey("");
      setValue("");
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not set tag.");
    },
  });

  const remove = useMutation({
    mutationFn: ({ k }: { k: string }) => tagsApi.remove(teamId, serverId, k),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["server-tags", teamId, serverId] }),
  });

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!key.trim() || !value.trim()) {
      setError("Both key and value are required.");
      return;
    }
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(key.trim())) {
      setError("Keys may contain letters, digits, dot, dash, and underscore.");
      return;
    }
    set.mutate({ k: key.trim(), v: value.trim() });
  }

  const list = tags.data ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[7fr_5fr] gap-6">
      {/* table side ──────────────────────────────────────────── */}
      <div className="space-y-5">
        <form onSubmit={handleAdd} className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          {set.error && !error && (
            <Alert tone="error">{mutationErrorMessage(set.error)}</Alert>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <Field id="tag-key" label="Key">
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="env"
                autoComplete="off"
                maxLength={64}
              />
            </Field>
            <Field id="tag-value" label="Value">
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="production"
                autoComplete="off"
                maxLength={128}
              />
            </Field>
            <Button type="submit" loading={set.isPending}>
              <Plus className="h-3.5 w-3.5" /> Add tag
            </Button>
          </div>
        </form>

        {list.length === 0 ? (
          <EmptyState
            icon={<Tag className="h-4 w-4" />}
            title="No tags yet"
            body="Tags drive placement constraints — group servers by environment, region, or role and the scheduler uses them to pick deployment targets."
          />
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Key</TH>
                  <TH>Value</TH>
                  <TH align="right" className="w-12"> </TH>
                </TR>
              </THead>
              <TBody>
                {list.map((tag) => (
                  <TR key={`${tag.key}=${tag.value}`}>
                    <TD>
                      <span className="font-mono text-[12px] text-ink-1">{tag.key}</span>
                    </TD>
                    <TD>
                      <span className="font-mono text-[12px] text-ink-2">{tag.value}</span>
                    </TD>
                    <TD align="right">
                      <button
                        type="button"
                        onClick={() => remove.mutate({ k: tag.key })}
                        disabled={remove.isPending}
                        className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-alert hover:bg-surface-2 transition-colors disabled:opacity-50"
                        aria-label={`Remove tag ${tag.key}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>

      {/* hint side ──────────────────────────────────────────── */}
      <Card className="h-fit">
        <CardHeader>
          <div className="label-mono mb-1">Placement constraints</div>
          <h2 className="text-[15px] text-ink-1">How tags route workloads</h2>
        </CardHeader>
        <CardBody className="space-y-4 text-[12px] text-ink-2 leading-relaxed">
          <p>
            When an app is deployed, the scheduler honours tag-based constraints:
          </p>
          <pre className="rounded-[var(--radius-sm)] bg-surface-2 border border-line-1 p-3 font-mono text-[11px] text-ink-1 whitespace-pre-wrap leading-relaxed">
{`must_have:     { env: production, region: us-east }
must_not_have: { role: database }`}
          </pre>
          <p>
            Combine tags with the placement strategy (spread, binpack, pinned) to control fleet
            density and isolation.
          </p>
          <ul className="space-y-1.5 text-ink-3 text-[11px] font-mono uppercase tracking-[0.14em]">
            <li><span className="text-ink-1">env</span> · production / staging / preview</li>
            <li><span className="text-ink-1">region</span> · us-east / eu-west / sgp</li>
            <li><span className="text-ink-1">role</span> · web / worker / db</li>
            <li><span className="text-ink-1">class</span> · cpu-optimised / memory-optimised</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function mutationErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Mutation failed.";
}
