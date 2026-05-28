"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  GitBranch,
  Layers,
  Radar,
  Rocket,
  Shuffle,
  TriangleAlert,
} from "lucide-react";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Alert } from "@/components/primitives/Alert";
import { Badge } from "@/components/primitives/Badge";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/primitives/Table";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { appsApi, ApiError, type TrafficWeightInput } from "@/lib/api";
import type { App, TrafficBackend, TrafficView } from "@/lib/types";

interface Props {
  app: App;
  initialView: TrafficView;
}

const BAR_COLORS = [
  "var(--signal)",
  "var(--online)",
  "var(--info)",
  "var(--warn)",
  "var(--alert)",
];

export function TrafficClient({ app, initialView }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const view = useQuery({
    queryKey: ["traffic", app.id],
    queryFn: () => appsApi.getTraffic(app.id),
    initialData: initialView,
    refetchInterval: 20_000,
  });

  const backends = view.data?.backends ?? [];
  const route = view.data?.route ?? null;
  const events = view.data?.events ?? [];

  // Local draft weights — keyed by backend id. Initialised from server state.
  const [draft, setDraft] = useState<Record<string, number>>(() => weightsByBackend(backends));

  // Re-sync the draft when server data refreshes — unless the user has unsaved
  // changes (in which case we keep their edits to avoid clobbering them).
  useEffect(() => {
    if (!view.data) return;
    setDraft((prev) => (isDirty(prev, backends) ? prev : weightsByBackend(view.data.backends)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.data]);

  const dirty = isDirty(draft, backends);
  const draftTotal = Object.values(draft).reduce((a, b) => a + b, 0);

  const save = useMutation({
    mutationFn: () => {
      const payload: TrafficWeightInput[] = Object.entries(draft).map(([id, weight]) => ({
        backend_id: id,
        weight,
      }));
      return appsApi.updateTraffic(app.id, payload);
    },
    onSuccess: (next) => {
      setError(null);
      queryClient.setQueryData(["traffic", app.id], next);
      setDraft(weightsByBackend(next.backends));
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not apply traffic weights."),
  });

  const promote = useMutation({
    mutationFn: (backendId: string) => appsApi.promoteBackend(app.id, backendId),
    onSuccess: (next) => {
      setError(null);
      queryClient.setQueryData(["traffic", app.id], next);
      setDraft(weightsByBackend(next.backends));
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not promote backend."),
  });

  // Empty state — no route yet (typical when the app has no healthy deployments)
  if (!route || backends.length === 0) {
    return (
      <EmptyState
        icon={<Radar className="h-4 w-4" />}
        title="No active route"
        body="A traffic route is created automatically once the first deployment is healthy. Until then, requests flow straight to the latest deploy."
      />
    );
  }

  function setWeight(id: string, raw: number) {
    const w = Math.max(0, Math.min(100, Math.round(raw)));
    setDraft((prev) => ({ ...prev, [id]: w }));
  }

  function normalise() {
    const total = Object.values(draft).reduce((a, b) => a + b, 0);
    if (total === 0) return;
    const ids = Object.keys(draft);
    const scaled: Record<string, number> = {};
    let running = 0;
    ids.forEach((id, i) => {
      const isLast = i === ids.length - 1;
      const v = isLast ? 100 - running : Math.round((draft[id] / total) * 100);
      scaled[id] = v;
      running += v;
    });
    setDraft(scaled);
  }

  return (
    <div className="space-y-6 max-w-[960px]">
      {error && <Alert tone="error">{error}</Alert>}

      {/* Route header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="label-mono mb-1 flex items-center gap-2">
                <Shuffle className="h-3 w-3" /> Route
              </div>
              <h2 className="text-[18px] text-ink-1 font-mono">{route.domain || "—"}</h2>
              <p className="mt-1 text-[12px] text-ink-3 max-w-md">
                Requests for this domain are split across the backends below. Weights are
                relative — the router converts them to percentages of the total.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="signal">{route.mode || "simple"}</Badge>
              <Badge tone={routeStatusTone(route.status)} dot>{route.status}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          <SplitBar draft={draft} backends={backends} />
        </CardBody>
      </Card>

      {/* Backend editors */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="label-mono mb-1">Backends</div>
              <h2 className="text-[16px] text-ink-1">Weight per deployment</h2>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
              total {draftTotal}
            </div>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {backends.map((b, i) => (
            <BackendRow
              key={b.id}
              backend={b}
              color={BAR_COLORS[i % BAR_COLORS.length]}
              weight={draft[b.id] ?? 0}
              onWeight={(w) => setWeight(b.id, w)}
              onPromote={() => promote.mutate(b.id)}
              promotingId={promote.isPending ? (promote.variables ?? null) : null}
            />
          ))}
        </CardBody>
        <CardFooter>
          {draftTotal !== 100 && (
            <span className="text-[12px] text-warn mr-auto inline-flex items-center gap-1.5">
              <TriangleAlert className="h-3 w-3" />
              Weights must total 100 (currently {draftTotal}).
            </span>
          )}
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
            {dirty ? "unsaved" : "no changes"}
          </span>
          <Button
            type="button"
            variant="secondary"
            onClick={normalise}
            disabled={draftTotal === 0 || draftTotal === 100}
          >
            Normalise to 100
          </Button>
          <Button
            type="button"
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!dirty || draftTotal !== 100}
          >
            <Layers className="h-3.5 w-3.5" /> Apply weights
          </Button>
        </CardFooter>
      </Card>

      {/* Events */}
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <div className="label-mono mb-1">Audit</div>
            <h2 className="text-[18px] text-ink-1">Traffic events</h2>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
            {events.length} {events.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        {events.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-4 w-4" />}
            title="No traffic events yet"
            body="Weight changes and promotions will appear here."
          />
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Event</TH>
                  <TH>By</TH>
                  <TH>Detail</TH>
                </TR>
              </THead>
              <TBody>
                {events.map((ev) => (
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
                      <span className="font-mono text-[11px] text-ink-3">{ev.actor_type}</span>
                    </TD>
                    <TD>
                      <span className="text-[12px] text-ink-3">{ev.message || "—"}</span>
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

function BackendRow({
  backend,
  color,
  weight,
  onWeight,
  onPromote,
  promotingId,
}: {
  backend: TrafficBackend;
  color: string;
  weight: number;
  onWeight: (w: number) => void;
  onPromote: () => void;
  promotingId: string | null;
}) {
  const ready = backend.replicas_ready ?? 0;
  const desired = backend.replicas_desired ?? 0;
  const promoting = promotingId === backend.id;
  return (
    <div className="rounded-[var(--radius-md)] border border-line-1 bg-surface-1 p-3.5">
      <div className="flex items-center gap-3 flex-wrap">
        <span
          aria-hidden
          className="h-3 w-3 rounded-full shrink-0"
          style={{ background: color }}
        />
        <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-1">
          {backend.label || "backend"}
        </span>
        <Badge tone={deployTone(backend.deployment_status)} dot>
          {backend.deployment_status}
        </Badge>
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-3 num">
          {ready}/{desired} ready
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
          <GitBranch className="h-3 w-3" /> {backend.commit_sha?.slice(0, 7) || "—"}
        </span>
        <span className="font-mono text-[10px] text-ink-4 truncate max-w-[200px]">
          {backend.image_tag || "—"}
        </span>

        <div className="ml-auto">
          <ConfirmDialog
            title={`Send all traffic to ${backend.label || "this backend"}?`}
            description={
              <>
                Promotes <span className="text-ink-1">{backend.label}</span> to 100% and zeros
                the others. Useful to roll forward after a canary, or roll back during one.
              </>
            }
            confirmLabel="Promote"
            destructive
            onConfirm={() =>
              new Promise<void>((resolve) => {
                onPromote();
                resolve();
              })
            }
            trigger={
              <Button type="button" variant="ghost" size="sm" loading={promoting}>
                <Rocket className="h-3.5 w-3.5" /> Promote
              </Button>
            }
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_72px] gap-3 items-center">
        <input
          type="range"
          min={0}
          max={100}
          value={weight}
          onChange={(e) => onWeight(Number(e.target.value))}
          className="w-full accent-[color:var(--signal)]"
          aria-label={`Weight for ${backend.label}`}
        />
        <input
          type="number"
          min={0}
          max={100}
          value={weight}
          onChange={(e) => onWeight(Number(e.target.value))}
          className="h-9 w-full text-center font-mono num text-[13px] text-ink-1 bg-surface-1 border border-line-1 rounded-[var(--radius-sm)] focus:outline-none focus:ring-1 focus:ring-signal"
        />
      </div>
    </div>
  );
}

function SplitBar({
  draft,
  backends,
}: {
  draft: Record<string, number>;
  backends: TrafficBackend[];
}) {
  const segments = useMemo(() => {
    const total = Object.values(draft).reduce((a, b) => a + b, 0);
    if (total === 0) return [];
    return backends.map((b, i) => ({
      id: b.id,
      label: b.label,
      pct: ((draft[b.id] ?? 0) / total) * 100,
      color: BAR_COLORS[i % BAR_COLORS.length],
    }));
  }, [draft, backends]);

  if (segments.length === 0) {
    return (
      <div className="h-7 rounded-[var(--radius-sm)] border border-line-1 bg-surface-2 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
        no traffic
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex h-7 rounded-[var(--radius-sm)] overflow-hidden border border-line-1">
        {segments.map((s) => (
          <div
            key={s.id}
            className="h-full flex items-center justify-center font-mono text-[10px] text-[color:var(--bg-0)] mix-blend-luminosity"
            style={{ width: `${s.pct}%`, background: s.color }}
            title={`${s.label}: ${s.pct.toFixed(1)}%`}
          >
            {s.pct >= 8 && <span>{s.pct.toFixed(0)}%</span>}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ background: s.color }}
            />
            <span className="font-mono text-[11px] text-ink-2">{s.label}</span>
            <span className="font-mono text-[11px] text-ink-3 num">{s.pct.toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function weightsByBackend(list: TrafficBackend[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of list) out[b.id] = Math.max(0, Math.min(100, b.weight ?? 0));
  return out;
}

function isDirty(draft: Record<string, number>, backends: TrafficBackend[]): boolean {
  if (Object.keys(draft).length !== backends.length) return true;
  for (const b of backends) if ((draft[b.id] ?? 0) !== b.weight) return true;
  return false;
}

function deployTone(status: string): "online" | "warn" | "alert" | "neutral" | "signal" {
  switch (status) {
    case "healthy":   return "online";
    case "deploying": return "signal";
    case "degraded":  return "warn";
    case "failed":
    case "rolled_back": return "alert";
    default: return "neutral";
  }
}

function routeStatusTone(status: string): "online" | "warn" | "alert" | "neutral" | "signal" {
  switch (status) {
    case "active":   return "online";
    case "draining": return "warn";
    case "disabled": return "alert";
    default: return "neutral";
  }
}

function eventTone(type: string): "online" | "warn" | "alert" | "neutral" | "signal" {
  if (type.includes("promote")) return "signal";
  if (type.includes("update") || type.includes("weight")) return "online";
  if (type.includes("disable") || type.includes("fail")) return "alert";
  return "neutral";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16);
}
