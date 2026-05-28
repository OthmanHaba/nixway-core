"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Layers, RotateCcw, ScrollText, Server as ServerIcon, X } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Alert } from "@/components/primitives/Alert";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogEyebrow } from "@/components/primitives/Dialog";
import { DeploymentStatusBadge } from "./DeploymentStatusBadge";
import { LogStream } from "./LogStream";
import { deploymentsApi, appsApi, ApiError } from "@/lib/api";
import type { Deployment, DeploymentTarget, Environment } from "@/lib/types";

interface Props {
  appId: string;
  environments: Environment[];
  initialDeployments: Deployment[];
}

export function DeploymentsClient({ appId, environments, initialDeployments }: Props) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openLogs, setOpenLogs] = useState<Deployment | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const deployments = useQuery({
    queryKey: ["app-deployments", appId],
    queryFn: () => deploymentsApi.list(appId),
    initialData: initialDeployments,
    refetchInterval: (q) => {
      const data = q.state.data ?? [];
      const hasActive = data.some((d) =>
        ["pending", "deploying"].includes(d.status),
      );
      return hasActive ? 5_000 : false;
    },
  });

  const rollback = useMutation({
    mutationFn: (environment_id?: string) => appsApi.rollback(appId, environment_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-deployments", appId] });
      queryClient.invalidateQueries({ queryKey: ["app-builds", appId] });
    },
  });

  const envById = new Map(environments.map((e) => [e.id, e] as const));
  const allList = deployments.data ?? [];
  const archivedCount = allList.filter((d) => d.status === "archived").length;
  const list = showArchived ? allList : allList.filter((d) => d.status !== "archived");
  const prodEnv = environments.find((e) => e.is_production);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Layers className="h-3 w-3" /> Deployment history
          </div>
          <p className="text-[13px] text-ink-3 max-w-md">
            Each deployment binds a build to one or more servers in the cluster, runs health
            checks, and shifts traffic. Rolling back reverts to the previous healthy deployment
            in the same environment.
          </p>
        </div>
        {list.length > 0 && (
          <ConfirmDialog
            destructive
            title={`Roll back ${prodEnv?.name ?? "production"}?`}
            description={
              <>
                The current deployment in <span className="text-ink-1">{prodEnv?.name ?? "production"}</span> will
                stop and the previous healthy deployment will take traffic. Any in-flight requests will be drained
                normally.
              </>
            }
            confirmLabel="Roll back now"
            onConfirm={() =>
              new Promise<void>((resolve, reject) =>
                rollback.mutate(prodEnv?.id, {
                  onSuccess: () => resolve(),
                  onError: (e) => reject(e),
                }),
              )
            }
            trigger={
              <Button variant="secondary">
                <RotateCcw className="h-3.5 w-3.5" /> Roll back
              </Button>
            }
          />
        )}
      </div>

      {rollback.error && (
        <Alert tone="error">{mutationErrorMessage(rollback.error)}</Alert>
      )}
      {rollback.isSuccess && !rollback.isPending && (
        <Alert tone="success" title="Rollback in progress">
          A rollback deployment was created. Watch its status complete below.
        </Alert>
      )}

      {archivedCount > 0 && (
        <div className="flex items-center justify-between text-[12px] text-ink-3">
          <span>
            {archivedCount} archived deployment{archivedCount === 1 ? "" : "s"} — images
            pruned, no rollback target.
          </span>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-ink-1 underline-offset-4 hover:underline"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-4 w-4" />}
          title="No deployments yet"
          body="Trigger a build — successful builds auto-create a deployment if the app has auto-deploy on."
        />
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Deployment</TH>
                <TH>Environment</TH>
                <TH>Strategy</TH>
                <TH>Replicas</TH>
                <TH>Status</TH>
                <TH>Started</TH>
                <TH align="right" className="w-24"> </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((d) => {
                const isOpen = expanded === d.id;
                return (
                  <DeploymentRow
                    key={d.id}
                    appId={appId}
                    deployment={d}
                    envName={envById.get(d.environment_id)?.name}
                    isOpen={isOpen}
                    onToggle={() => setExpanded(isOpen ? null : d.id)}
                    onOpenLogs={() => setOpenLogs(d)}
                  />
                );
              })}
            </TBody>
          </Table>
        </div>
      )}

      {openLogs && (
        <DeploymentLogsDialog
          appId={appId}
          deployment={openLogs}
          onClose={() => setOpenLogs(null)}
        />
      )}
    </div>
  );
}

function DeploymentLogsDialog({
  appId,
  deployment,
  onClose,
}: {
  appId: string;
  deployment: Deployment;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="w-[min(900px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)]"
        hideClose
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogEyebrow>Deployment · logs</DialogEyebrow>
              <DialogTitle className="text-xl font-mono">
                {deployment.id.slice(0, 8)}
              </DialogTitle>
              <p className="mt-1 text-[12px] text-ink-3">
                Status <span className="text-ink-2">{deployment.status}</span>
                {" · "}
                {deployment.replicas_ready}/{deployment.replicas_desired} replicas ready
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </DialogHeader>
        <DialogBody>
          <LogStream
            url={deploymentsApi.logsUrl(appId, deployment.id)}
            title={`Deployment ${deployment.id.slice(0, 8)}`}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function DeploymentRow({
  appId,
  deployment,
  envName,
  isOpen,
  onToggle,
  onOpenLogs,
}: {
  appId: string;
  deployment: Deployment;
  envName?: string;
  isOpen: boolean;
  onToggle: () => void;
  onOpenLogs: () => void;
}) {
  const targets = useQuery({
    queryKey: ["deployment-targets", deployment.id],
    queryFn: () => deploymentsApi.targets(appId, deployment.id),
    enabled: isOpen,
  });

  return (
    <>
      <TR>
        <TD>
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 text-left"
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-ink-3" />
            )}
            <span className="font-mono text-[11px] text-ink-1">
              {deployment.id.slice(0, 8)}
            </span>
          </button>
        </TD>
        <TD><span className="font-mono text-[11px] text-ink-2">{envName ?? "—"}</span></TD>
        <TD>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 border border-line-1 rounded-[3px] px-1.5 py-0.5">
            {deployment.strategy || "rolling"}
          </span>
        </TD>
        <TD>
          <span className="font-mono text-[12px] num">
            <span
              className={
                deployment.replicas_ready === deployment.replicas_desired
                  ? "text-online"
                  : "text-warn"
              }
            >
              {deployment.replicas_ready}
            </span>
            <span className="text-ink-3"> / </span>
            <span className="text-ink-1">{deployment.replicas_desired}</span>
          </span>
        </TD>
        <TD><DeploymentStatusBadge status={deployment.status} /></TD>
        <TD>
          <span className="font-mono text-[11px] text-ink-3 num">
            {deployment.started_at ? formatRelative(deployment.started_at) : "—"}
          </span>
        </TD>
        <TD align="right">
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenLogs(); }}
              className="flex items-center gap-1 px-1.5 py-1 rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors font-mono text-[10px] uppercase tracking-[0.14em]"
              title="View deployment logs"
            >
              <ScrollText className="h-3 w-3" />
              Logs
            </button>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4 px-1.5">
              {isOpen ? "Hide" : "Targets"}
            </span>
          </div>
        </TD>
      </TR>
      {isOpen && (
        <TR>
          <TD className="!pt-0 !pb-4">
          </TD>
          <td colSpan={6} className="pt-0 pb-4 pr-4">
            {targets.isLoading ? (
              <div className="text-[12px] text-ink-3 px-4">Loading targets…</div>
            ) : targets.error ? (
              <Alert tone="error">{mutationErrorMessage(targets.error)}</Alert>
            ) : (
              <TargetsList targets={targets.data ?? []} />
            )}
          </td>
        </TR>
      )}
    </>
  );
}

function TargetsList({ targets }: { targets: DeploymentTarget[] }) {
  if (targets.length === 0) {
    return <div className="text-[12px] text-ink-3 px-4">No targets recorded for this deployment.</div>;
  }
  return (
    <ul className="rounded-[var(--radius-sm)] border border-line-1 bg-surface-2/40 divide-y divide-line-1">
      {targets.map((t) => {
        const onMesh = t.host_port != null && t.bind_address != null;
        return (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-[12px]">
            <ServerIcon className="h-3.5 w-3.5 text-ink-3" />
            <span className="font-mono text-ink-2">{t.server_name ?? t.server_id.slice(0, 8)}</span>
            <span className="text-ink-4">·</span>
            <span className="font-mono text-ink-2 truncate flex-1">
              {t.container_id ? t.container_id.slice(0, 12) : "no container"}
            </span>
            {onMesh ? (
              <span
                className="font-mono text-[10px] text-signal border border-signal/40 bg-signal/5 rounded-[3px] px-1.5 py-0.5 num"
                title="Reachable on the WireGuard mesh — edge LB routes here"
              >
                mesh {t.bind_address}:{t.host_port}
              </span>
            ) : (
              <span
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4"
                title="Edge LB not enabled — node-local Traefik handles this replica"
              >
                local
              </span>
            )}
            <span className="font-mono uppercase tracking-[0.14em] text-[10px] text-ink-3">
              {t.status}
            </span>
            {t.healthy_at && (
              <span className="font-mono text-[10px] text-online num">
                healthy {formatRelative(t.healthy_at)}
              </span>
            )}
            {t.error && (
              <span className="font-mono text-[10px] text-alert truncate max-w-[200px]">
                {t.error}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

function mutationErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Mutation failed.";
}
