"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitCommit, Hammer, Play, ScrollText, X } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogEyebrow } from "@/components/primitives/Dialog";
import { BuildStatusBadge } from "./BuildStatusBadge";
import { LogStream } from "./LogStream";
import { TriggerBuildDialog } from "./TriggerBuildDialog";
import { buildsApi } from "@/lib/api";
import type { Build, Environment } from "@/lib/types";

interface Props {
  appId: string;
  environments: Environment[];
  initialBuilds: Build[];
}

export function BuildsClient({ appId, environments, initialBuilds }: Props) {
  const [openBuild, setOpenBuild] = useState<Build | null>(null);

  const builds = useQuery({
    queryKey: ["app-builds", appId],
    queryFn: () => buildsApi.list(appId),
    initialData: initialBuilds,
    // Poll while any build is mid-flight.
    refetchInterval: (q) => {
      const data = q.state.data ?? [];
      const hasActive = data.some((b) =>
        ["pending", "cloning", "building"].includes(b.status),
      );
      return hasActive ? 5_000 : false;
    },
  });

  const envById = new Map(environments.map((e) => [e.id, e] as const));
  const list = builds.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Hammer className="h-3 w-3" /> Build history
          </div>
          <p className="text-[13px] text-ink-3 max-w-md">
            Each build clones, builds, and pushes an image. On success the platform auto-creates
            a deployment if the app has auto-deploy enabled.
          </p>
        </div>
        <TriggerBuildDialog
          appId={appId}
          environments={environments}
          trigger={
            <Button>
              <Play className="h-3.5 w-3.5" /> Trigger build
            </Button>
          }
        />
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<Hammer className="h-4 w-4" />}
          title="No builds yet"
          body="Trigger your first build. Builders work through the queue and push the produced image to the configured registry."
        />
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Commit</TH>
                <TH>Trigger</TH>
                <TH>Environment</TH>
                <TH>Status</TH>
                <TH>Started</TH>
                <TH>Completed</TH>
                <TH align="right" className="w-24"> </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((b) => (
                <TR key={b.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <GitCommit className="h-3.5 w-3.5 text-ink-3" />
                      <div className="min-w-0">
                        <div className="font-mono text-[12px] text-ink-1">
                          {b.commit_sha ? b.commit_sha.slice(0, 8) : "—"}
                        </div>
                        {b.commit_message && (
                          <div className="text-[11px] text-ink-3 truncate max-w-[220px]">
                            {b.commit_message}
                          </div>
                        )}
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-2 uppercase tracking-[0.14em]">
                      {b.trigger_type}
                    </span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-2">
                      {envById.get(b.environment_id)?.name ?? "—"}
                    </span>
                  </TD>
                  <TD><BuildStatusBadge status={b.status} /></TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-3 num">
                      {b.started_at ? formatRelative(b.started_at) : "—"}
                    </span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-3 num">
                      {b.completed_at ? formatDuration(b.started_at, b.completed_at) : "—"}
                    </span>
                  </TD>
                  <TD align="right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenBuild(b)}
                    >
                      <ScrollText className="h-3.5 w-3.5" /> Logs
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      {openBuild && (
        <BuildLogsDialog build={openBuild} appId={appId} onClose={() => setOpenBuild(null)} />
      )}
    </div>
  );
}

function BuildLogsDialog({
  build,
  appId,
  onClose,
}: {
  build: Build;
  appId: string;
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
              <DialogEyebrow>Build · logs</DialogEyebrow>
              <DialogTitle className="text-xl">
                {build.commit_sha ? build.commit_sha.slice(0, 8) : "Build"}
              </DialogTitle>
              {build.commit_message && (
                <p className="mt-1 text-[12px] text-ink-3 max-w-[60ch]">{build.commit_message}</p>
              )}
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
            url={buildsApi.logsUrl(appId, build.id)}
            title={`Build ${build.commit_sha ? build.commit_sha.slice(0, 8) : ""}`.trim()}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
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

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return "—";
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return "—";
  const sec = Math.max(0, Math.round((e - s) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}
