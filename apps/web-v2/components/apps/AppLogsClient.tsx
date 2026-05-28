"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Cpu, RefreshCw, Search } from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/primitives/Select";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { EmptyState } from "@/components/primitives/EmptyState";
import { LogStream } from "./LogStream";
import { appsApi } from "@/lib/api";
import type { Replica } from "@/lib/types";

interface Props {
  appId: string;
  initialReplicas: Replica[];
}

const TAIL_OPTIONS = [50, 200, 500, 1000];

export function AppLogsClient({ appId, initialReplicas }: Props) {
  const replicas = useQuery({
    queryKey: ["app-replicas", appId],
    queryFn: () => appsApi.listReplicas(appId),
    initialData: initialReplicas,
    refetchInterval: 15_000,
  });

  // Pick a stable default container — the first eligible one.
  const list = useMemo(
    () => (replicas.data ?? []).filter((r) => r.container_id),
    [replicas.data],
  );
  const [container, setContainer] = useState<string>("");
  const [tail, setTail] = useState<number>(200);
  const [filter, setFilter] = useState("");

  // Resolve the active container's logs URL (or empty when nothing to stream).
  const effectiveContainer =
    container ||
    (list[0]?.container_id ? containerNameFromId(list[0].container_id) : "");

  const url = effectiveContainer
    ? appsApi.logsUrl(appId, {
        container: effectiveContainer,
        tail,
        follow: true,
      })
    : appsApi.logsUrl(appId, { tail, follow: true });

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Cpu className="h-4 w-4" />}
        title="No active containers"
        body="This app doesn't have any running containers right now. Once a deployment is healthy, its containers will appear here and stream their logs."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_2fr] gap-3 items-end">
        <div className="space-y-1.5">
          <div className="label-mono">Container</div>
          <Select value={effectiveContainer} onValueChange={setContainer}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a container" />
            </SelectTrigger>
            <SelectContent>
              {list.map((r) => {
                const name = containerNameFromId(r.container_id ?? "");
                return (
                  <SelectItem key={r.target_id} value={name}>
                    <span className="inline-flex items-center gap-2">
                      <Box className="h-3 w-3 text-ink-3" />
                      <span className="font-mono text-[12px]">{name.slice(0, 18)}</span>
                      <span className="font-mono text-[10px] text-ink-3 ml-1">
                        on {r.server_name}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <div className="label-mono">Tail</div>
          <div className="flex items-center gap-1">
            {TAIL_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTail(n)}
                className={
                  "h-10 px-3 rounded-[var(--radius-sm)] font-mono text-[11px] border transition-colors " +
                  (tail === n
                    ? "border-signal bg-[color:var(--signal-soft)]/30 text-ink-1"
                    : "border-line-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1")
                }
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="label-mono flex items-center justify-between">
            <span>Filter</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                // Force a remount by toggling tail — quickest way to reconnect SSE.
                setTail((t) => (t === 200 ? 201 : 200));
              }}
              className="-mr-2"
            >
              <RefreshCw className="h-3 w-3" /> Reconnect
            </Button>
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-ink-3 absolute left-0 top-1/2 -translate-y-1/2" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="error, request, level=…"
              className="pl-6"
              autoComplete="off"
            />
          </div>
        </div>
      </div>

      <LogStream
        url={url}
        title={effectiveContainer ? truncateContainer(effectiveContainer) : "logs"}
        filter={filter}
        className="h-[min(640px,calc(100dvh-260px))]"
      />
    </div>
  );
}

function containerNameFromId(containerIdOrName: string): string {
  // The "container" query param expects a container name. The DB stores the
  // container_id which is what the agent uses to identify the container —
  // some setups store the friendly name there. Pass it through verbatim.
  return containerIdOrName;
}

function truncateContainer(name: string): string {
  if (name.length <= 24) return name;
  return name.slice(0, 12) + "…" + name.slice(-8);
}
