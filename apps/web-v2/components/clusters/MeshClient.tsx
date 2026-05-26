"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Network, Activity } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { Alert } from "@/components/primitives/Alert";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { MeshMatrix } from "./MeshMatrix";
import { meshApi, ApiError } from "@/lib/api";
import type { MeshPeer } from "@/lib/types";

interface Props {
  teamId: string;
  clusterId: string;
  initialPeers: MeshPeer[];
}

export function MeshClient({ teamId, clusterId, initialPeers }: Props) {
  const queryClient = useQueryClient();

  const peers = useQuery({
    queryKey: ["cluster-mesh", clusterId],
    queryFn: () => meshApi.health(teamId, clusterId),
    initialData: initialPeers,
    refetchInterval: 15_000,
  });

  const regenerate = useMutation({
    mutationFn: () => meshApi.regenerate(teamId, clusterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cluster-mesh", clusterId] });
      queryClient.invalidateQueries({ queryKey: ["cluster-members", clusterId] });
    },
  });

  const list = peers.data ?? [];
  const healthy = list.filter(
    (p) =>
      p.rtt_ms != null &&
      ["active", "healthy", "ok"].includes(p.status?.toLowerCase() ?? ""),
  ).length;
  const total = list.length;

  return (
    <div className="space-y-6">
      {/* summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryTile label="Links" value={total} sub="peer edges" />
        <SummaryTile
          label="Healthy"
          value={healthy}
          sub={total > 0 ? `${Math.round((healthy / total) * 100)}% nominal` : "—"}
          tone={total === 0 ? "neutral" : healthy === total ? "on" : healthy === 0 ? "off" : "warn"}
        />
        <SummaryTile
          label="Average RTT"
          value={averageRtt(list)}
          sub="ms"
          tone="info"
        />
      </div>

      {/* toolbar */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Network className="h-3 w-3" /> Health matrix
          </div>
          <p className="text-[13px] text-ink-3 max-w-md">
            Each cell is one direction of a peer link. Hover for the full handshake details;
            color reflects measured RTT.
          </p>
        </div>
        <ConfirmDialog
          title="Regenerate the mesh?"
          description={
            <>
              We&rsquo;ll rotate every WireGuard key in this cluster, push fresh peer configs to
              every agent, and force a re-handshake. Expect a brief connectivity interruption.
            </>
          }
          confirmLabel="Regenerate mesh"
          onConfirm={() =>
            new Promise<void>((resolve, reject) =>
              regenerate.mutate(undefined, {
                onSuccess: () => resolve(),
                onError: (e) => reject(e),
              }),
            )
          }
          trigger={
            <Button variant="secondary" loading={regenerate.isPending}>
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate mesh
            </Button>
          }
        />
      </div>

      {regenerate.error && (
        <Alert tone="error">{mutationErrorMessage(regenerate.error)}</Alert>
      )}
      {regenerate.isSuccess && !regenerate.isPending && (
        <Alert tone="success" title="Mesh regenerated">
          New peer configs are being applied across the cluster. The matrix will refresh as
          handshakes complete.
        </Alert>
      )}

      <MeshMatrix peers={list} />

      {/* tip */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Activity className="h-3 w-3" /> DNS resolution
          </div>
        </CardHeader>
        <CardBody className="text-[12px] text-ink-2 leading-relaxed space-y-2">
          <p>
            Members in this cluster reach each other by name through CoreDNS. Hostnames take the form:
          </p>
          <pre className="rounded-[var(--radius-sm)] bg-surface-2 border border-line-1 p-3 font-mono text-[11px] text-ink-1 whitespace-pre-wrap">
{`{server-name}.{cluster-slug}.internal   → WireGuard IP
{app-name}.{cluster-slug}.internal      → container IP`}
          </pre>
        </CardBody>
      </Card>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  tone = "info",
}: {
  label: string;
  value: number | string;
  sub: string;
  tone?: "on" | "warn" | "off" | "info" | "neutral";
}) {
  const dot =
    tone === "on"
      ? "bg-online"
      : tone === "warn"
        ? "bg-warn"
        : tone === "off"
          ? "bg-alert"
          : tone === "info"
            ? "bg-info"
            : "bg-ink-4/40";
  return (
    <div className="rounded-[var(--radius)] border border-line-1 bg-surface-1 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="label-mono">{label}</span>
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-3xl text-ink-1 num leading-none">
          {typeof value === "number" ? value.toString().padStart(2, "0") : value}
        </span>
      </div>
      <div className="mt-2 text-[11px] text-ink-3">{sub}</div>
    </div>
  );
}

function averageRtt(peers: MeshPeer[]): string {
  const sample = peers.filter((p) => p.rtt_ms != null);
  if (sample.length === 0) return "—";
  const avg = sample.reduce((sum, p) => sum + (p.rtt_ms ?? 0), 0) / sample.length;
  return avg.toFixed(avg >= 100 ? 0 : 1);
}

function mutationErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Mutation failed.";
}
