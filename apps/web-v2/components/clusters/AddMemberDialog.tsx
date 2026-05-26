"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Cpu } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogEyebrow,
  DialogClose,
} from "@/components/primitives/Dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/primitives/Select";
import { Button } from "@/components/primitives/Button";
import { Alert } from "@/components/primitives/Alert";
import { clusterMembersApi, ApiError } from "@/lib/api";
import type { Server } from "@/lib/types";

export function AddMemberDialog({
  teamId,
  clusterId,
  candidates,
  trigger,
}: {
  teamId: string;
  clusterId: string;
  candidates: Server[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [serverId, setServerId] = useState<string>(candidates[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const add = useMutation({
    mutationFn: () => clusterMembersApi.add(teamId, clusterId, serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cluster-members", clusterId] });
      queryClient.invalidateQueries({ queryKey: ["cluster-mesh", clusterId] });
      setOpen(false);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not add the server.");
    },
  });

  function handleAdd() {
    if (!serverId) return setError("Pick a server.");
    add.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setError(null);
          setServerId(candidates[0]?.id ?? "");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>Mesh · join</DialogEyebrow>
          <DialogTitle>Add a server</DialogTitle>
          <DialogDescription>
            Pick a server from the team to join the cluster. We&rsquo;ll assign a WireGuard IP,
            generate a peer key, and push the mesh config to the agent automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {candidates.length === 0 ? (
            <Alert tone="warn" title="No eligible servers">
              All registered servers are already in this cluster.{" "}
              <Link href="/servers" className="text-signal hover:underline underline-offset-4">
                Register another →
              </Link>
            </Alert>
          ) : (
            <div className="space-y-2">
              <div className="label-mono">Server</div>
              <Select value={serverId} onValueChange={setServerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a server" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((srv) => (
                    <SelectItem key={srv.id} value={srv.id}>
                      <span className="inline-flex items-center gap-2">
                        <Cpu className="h-3 w-3 text-ink-3" />
                        <span>{srv.name}</span>
                        <span className="font-mono text-[10px] text-ink-3 ml-1">
                          {srv.hostname}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleAdd}
            loading={add.isPending}
            disabled={candidates.length === 0 || !serverId}
          >
            Add to cluster <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
