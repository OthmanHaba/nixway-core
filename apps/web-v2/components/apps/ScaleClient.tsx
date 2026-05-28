"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Anchor,
  ArrowDown,
  Layers,
  MapPin,
  Minus,
  Plus,
  Server as ServerIcon,
  Target,
  TriangleAlert,
} from "lucide-react";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Alert } from "@/components/primitives/Alert";
import { Badge } from "@/components/primitives/Badge";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/primitives/Table";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { appsApi, ApiError } from "@/lib/api";
import type { App, ClusterMember, ScalingEvent } from "@/lib/types";
import { cn } from "@/lib/cn";

interface Props {
  app: App;
  members: ClusterMember[];
  initialEvents: ScalingEvent[];
}

type Strategy = "spread" | "binpack" | "pinned";

const STRATEGY_OPTIONS: Array<{
  key: Strategy;
  title: string;
  body: string;
  icon: ReactNode;
}> = [
  {
    key: "spread",
    title: "Spread",
    body: "Distribute replicas evenly across cluster members. Best for resilience — a single server going dark only loses one slice.",
    icon: <Layers className="h-3.5 w-3.5" />,
  },
  {
    key: "binpack",
    title: "Binpack",
    body: "Pack replicas onto as few servers as possible. Maximises room for other workloads, at the cost of co-locating failure.",
    icon: <Target className="h-3.5 w-3.5" />,
  },
  {
    key: "pinned",
    title: "Pinned",
    body: "Constrain placement to a specific set of cluster members. Use when a workload needs particular hardware or zones.",
    icon: <Anchor className="h-3.5 w-3.5" />,
  },
];

const REPLICA_PRESETS = [1, 2, 3, 5, 10];

export function ScaleClient({ app, members, initialEvents }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const initialReplicas = Math.max(1, Number(app.replicas) || 1);
  const initialStrategy = (app.placement_strategy as Strategy | undefined) || "spread";
  const initialPinned = useMemo(() => app.pinned_server_ids ?? [], [app.pinned_server_ids]);

  const [replicas, setReplicas] = useState<number>(initialReplicas);
  const [strategy, setStrategy] = useState<Strategy>(initialStrategy);
  const [pinned, setPinned] = useState<string[]>(initialPinned);
  const [error, setError] = useState<string | null>(null);

  const events = useQuery({
    queryKey: ["scaling-events", app.id],
    queryFn: () => appsApi.listScalingEvents(app.id, { limit: 20 }),
    initialData: initialEvents,
  });

  const dirty =
    replicas !== initialReplicas ||
    strategy !== initialStrategy ||
    // pinned changed only matters when strategy is pinned
    (strategy === "pinned" && !sameSet(pinned, initialPinned));

  const willScaleDown = replicas < initialReplicas;
  const needsPinnedSelection = strategy === "pinned" && pinned.length === 0;

  const scale = useMutation({
    mutationFn: () =>
      appsApi.scale(app.id, {
        replicas,
        placement_strategy: strategy,
        pinned_server_ids: strategy === "pinned" ? pinned : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app", app.id] });
      queryClient.invalidateQueries({ queryKey: ["scaling-events", app.id] });
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not apply scale change.");
    },
  });

  function togglePinned(serverId: string) {
    setPinned((prev) =>
      prev.includes(serverId) ? prev.filter((id) => id !== serverId) : [...prev, serverId],
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!dirty || needsPinnedSelection) return;
    if (willScaleDown) return; // a separate confirm dialog handles this
    scale.mutate();
  }

  const replicaList = useMemo(
    () => Array.from({ length: replicas }, (_, i) => i + 1),
    [replicas],
  );

  return (
    <div className="space-y-6 max-w-[920px]">
      <Alert tone="info">
        Scale changes take effect immediately — the scheduler reschedules replicas
        across the cluster and the previous deployment is replaced.
      </Alert>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Replica count */}
        <Card>
          <CardHeader>
            <div className="label-mono mb-1">Desired replicas</div>
            <h2 className="text-[18px] text-ink-1">Replica count</h2>
            <p className="mt-1 text-[13px] text-ink-3 max-w-md">
              Number of running container instances. Set higher to absorb load or
              survive a single-server outage; set lower to free capacity.
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setReplicas((r) => Math.max(1, r - 1))}
                className="h-10 w-10 grid place-items-center rounded-[var(--radius-sm)] border border-line-1 text-ink-2 hover:bg-surface-2 hover:text-ink-1 transition-colors"
                aria-label="Decrement"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                type="number"
                min={1}
                max={999}
                value={replicas}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setReplicas(Math.max(1, Math.min(999, Math.trunc(n))));
                }}
                className="h-12 w-24 text-center font-mono num text-[22px] text-ink-1 bg-surface-1 border border-line-1 rounded-[var(--radius-sm)] focus:outline-none focus:ring-1 focus:ring-signal"
              />
              <button
                type="button"
                onClick={() => setReplicas((r) => Math.min(999, r + 1))}
                className="h-10 w-10 grid place-items-center rounded-[var(--radius-sm)] border border-line-1 text-ink-2 hover:bg-surface-2 hover:text-ink-1 transition-colors"
                aria-label="Increment"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-1 ml-3">
                {REPLICA_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setReplicas(n)}
                    className={cn(
                      "h-9 px-3 rounded-[var(--radius-sm)] font-mono text-[11px] border transition-colors",
                      replicas === n
                        ? "border-signal bg-[color:var(--signal-soft)]/30 text-ink-1"
                        : "border-line-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="label-mono">Current</span>
              <span className="font-mono text-[12px] num text-ink-1">
                {initialReplicas} → {replicas}
              </span>
              {willScaleDown && (
                <Badge tone="warn" dot>Scale-down</Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {replicaList.map((n) => (
                <span
                  key={n}
                  className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-[3px] border border-line-1 bg-surface-2 font-mono text-[10px] text-ink-2"
                >
                  {n}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Placement strategy */}
        <Card>
          <CardHeader>
            <div className="label-mono mb-1">Placement</div>
            <h2 className="text-[18px] text-ink-1">Strategy</h2>
            <p className="mt-1 text-[13px] text-ink-3 max-w-md">
              How the scheduler picks which cluster members run each replica.
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {STRATEGY_OPTIONS.map((opt) => {
                const active = strategy === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setStrategy(opt.key)}
                    className={cn(
                      "text-left p-3.5 rounded-[var(--radius-md)] border bg-surface-1 transition-colors",
                      active
                        ? "border-signal ring-1 ring-signal/40"
                        : "border-line-1 hover:bg-surface-2",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-6 w-6 grid place-items-center rounded-full border",
                          active
                            ? "border-signal text-[color:var(--signal-ink)] bg-[color:var(--signal-soft)]"
                            : "border-line-1 text-ink-3",
                        )}
                      >
                        {opt.icon}
                      </span>
                      <span className="font-mono uppercase tracking-[0.14em] text-[11px] text-ink-1">
                        {opt.title}
                      </span>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{opt.body}</p>
                  </button>
                );
              })}
            </div>

            {strategy === "pinned" && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="label-mono">Pinned members</div>
                    <p className="text-[12px] text-ink-3">
                      Replicas may only run on the cluster members selected here.
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPinned(members.map((m) => m.server_id))}
                      className="font-mono uppercase tracking-[0.14em] text-[10px] text-ink-3 hover:text-ink-1 px-2 py-1"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setPinned([])}
                      className="font-mono uppercase tracking-[0.14em] text-[10px] text-ink-3 hover:text-ink-1 px-2 py-1"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {members.length === 0 ? (
                  <EmptyState
                    icon={<ServerIcon className="h-4 w-4" />}
                    title="No cluster members"
                    body="This project's cluster has no members yet. Add servers to the cluster before pinning."
                  />
                ) : (
                  <ul className="rounded-[var(--radius-md)] border border-line-1 divide-y divide-line-1 bg-surface-1 overflow-hidden">
                    {members.map((m) => {
                      const checked = pinned.includes(m.server_id);
                      return (
                        <li key={m.id}>
                          <label
                            className={cn(
                              "flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors",
                              checked ? "bg-[color:var(--signal-soft)]/15" : "hover:bg-surface-2",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePinned(m.server_id)}
                              className="h-3.5 w-3.5 accent-[color:var(--signal)]"
                            />
                            <ServerIcon className="h-3.5 w-3.5 text-ink-3" />
                            <span className="font-mono text-[12px] text-ink-1">
                              {m.server_name ?? m.server_id.slice(0, 8)}
                            </span>
                            <span className="font-mono text-[11px] text-ink-3">
                              {m.wireguard_ip}
                            </span>
                            <Badge
                              tone={m.status === "active" ? "online" : "neutral"}
                              dot={m.status === "active"}
                            >
                              {m.status}
                            </Badge>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {needsPinnedSelection && (
                  <p className="text-[12px] text-warn flex items-center gap-1.5">
                    <TriangleAlert className="h-3 w-3" /> Pick at least one member to pin to.
                  </p>
                )}
              </div>
            )}
          </CardBody>
          <CardFooter>
            {error && (
              <span className="text-[12px] text-alert mr-auto flex items-center gap-1.5">
                <TriangleAlert className="h-3 w-3" /> {error}
              </span>
            )}
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
              {dirty ? "unsaved" : "no changes"}
            </span>

            {willScaleDown ? (
              <ConfirmDialog
                title="Scale down replicas?"
                description={
                  <>
                    This will reduce <span className="text-ink-1">{app.name}</span> from{" "}
                    <span className="text-ink-1">{initialReplicas}</span> to{" "}
                    <span className="text-ink-1">{replicas}</span> replica
                    {replicas === 1 ? "" : "s"}. The scheduler stops the surplus containers
                    on their hosts. In-flight requests may be interrupted.
                  </>
                }
                confirmLabel="Scale down"
                destructive
                onConfirm={() =>
                  new Promise<void>((resolve, reject) =>
                    scale.mutate(undefined, {
                      onSuccess: () => resolve(),
                      onError: (e) => reject(e),
                    }),
                  )
                }
                trigger={
                  <Button
                    type="button"
                    loading={scale.isPending}
                    disabled={!dirty || needsPinnedSelection}
                  >
                    <ArrowDown className="h-3.5 w-3.5" /> Apply
                  </Button>
                }
              />
            ) : (
              <Button
                type="submit"
                loading={scale.isPending}
                disabled={!dirty || needsPinnedSelection}
              >
                Apply
              </Button>
            )}
          </CardFooter>
        </Card>
      </form>

      {/* Scaling history */}
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <div className="label-mono mb-1">Audit</div>
            <h2 className="text-[18px] text-ink-1">Scaling events</h2>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
            last {events.data?.length ?? 0}
          </span>
        </div>

        {(events.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Activity className="h-4 w-4" />}
            title="No scaling events yet"
            body="Manual scale changes and autoscaler decisions will show up here."
          />
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Event</TH>
                  <TH>Change</TH>
                  <TH>Strategy</TH>
                  <TH>By</TH>
                  <TH>Note</TH>
                </TR>
              </THead>
              <TBody>
                {events.data?.map((ev) => (
                  <TR key={ev.id}>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3 num">
                        {formatWhen(ev.created_at)}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={eventTone(ev.event_type)}>{ev.event_type}</Badge>
                    </TD>
                    <TD>
                      <span className="font-mono text-[12px] text-ink-1 num">
                        {ev.from_replicas} → {ev.to_replicas}
                      </span>
                    </TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3 w-3 text-ink-3" />
                        <span className="font-mono text-[11px] text-ink-2">
                          {ev.placement_strategy}
                        </span>
                      </span>
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3">{ev.actor_type}</span>
                    </TD>
                    <TD>
                      <span className="text-[12px] text-ink-3">
                        {ev.message || ev.rule_name || "—"}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const x of b) if (!s.has(x)) return false;
  return true;
}

function eventTone(type: string): "online" | "warn" | "neutral" | "signal" {
  if (type.includes("up") || type === "scale_up") return "online";
  if (type.includes("down") || type === "scale_down") return "warn";
  if (type.includes("auto")) return "signal";
  return "neutral";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16);
}
