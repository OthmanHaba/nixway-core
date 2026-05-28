"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Plus, Star } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Badge } from "@/components/primitives/Badge";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Alert } from "@/components/primitives/Alert";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { environmentsApi, ApiError } from "@/lib/api";
import type { Environment } from "@/lib/types";

export function EnvironmentsClient({
  projectId,
  initialEnvironments,
}: {
  projectId: string;
  initialEnvironments: Environment[];
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const environments = useQuery({
    queryKey: ["project-environments", projectId],
    queryFn: () => environmentsApi.list(projectId),
    initialData: initialEnvironments,
  });

  const create = useMutation({
    mutationFn: (n: string) => environmentsApi.create(projectId, n),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-environments", projectId] });
      setName("");
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not create the environment.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError("Environment name is required.");
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(trimmed)) {
      return setError("Letters, digits, dash, and underscore only.");
    }
    create.mutate(trimmed);
  }

  const list = environments.data ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[7fr_5fr] gap-6">
      <div className="space-y-5">
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <Field id="env-name" label="Environment name" hint="Common names: production, staging, preview, dev.">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="staging"
                autoComplete="off"
                maxLength={64}
              />
            </Field>
            <Button type="submit" loading={create.isPending}>
              <Plus className="h-3.5 w-3.5" /> Create
            </Button>
          </div>
        </form>

        {list.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-4 w-4" />}
            title="No environments yet"
            body="Environments scope secrets, builds, and deployments. Most teams start with a production env and add staging or preview later."
          />
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Slug</TH>
                  <TH>Tier</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <TBody>
                {list.map((env) => (
                  <TR key={env.id}>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        {env.is_production ? (
                          <Star className="h-3.5 w-3.5 text-signal" />
                        ) : (
                          <Layers className="h-3.5 w-3.5 text-ink-3" />
                        )}
                        <span className="text-[13px] text-ink-1">{env.name}</span>
                      </div>
                    </TD>
                    <TD>
                      <span className="font-mono text-[12px] text-ink-2">{env.slug}</span>
                    </TD>
                    <TD>
                      {env.is_production ? (
                        <Badge tone="signal" dot>Production</Badge>
                      ) : (
                        <Badge tone="neutral">Non-prod</Badge>
                      )}
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3 num">{formatDate(env.created_at)}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <div className="label-mono mb-1">How environments work</div>
          <h2 className="text-[15px] text-ink-1">Scoped configuration</h2>
        </CardHeader>
        <CardBody className="space-y-3 text-[12px] text-ink-2 leading-relaxed">
          <p>
            Environments isolate runtime configuration for the apps inside this project:
          </p>
          <ul className="space-y-1.5 text-[12px] text-ink-3">
            <li>· <span className="text-ink-1">Secrets</span> are versioned per env</li>
            <li>· <span className="text-ink-1">Builds</span> attach to one env at deploy time</li>
            <li>· <span className="text-ink-1">Audit log</span> tags every action with its env scope</li>
          </ul>
          <p>
            The first environment named &ldquo;production&rdquo; (or matching the platform&rsquo;s production
            heuristics) gets the production tier — additional safeguards apply.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
