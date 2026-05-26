"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Network } from "lucide-react";
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
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { projectsApi, ApiError } from "@/lib/api";
import type { Cluster } from "@/lib/types";

export function CreateProjectDialog({
  teamId,
  clusters,
  trigger,
}: {
  teamId: string;
  clusters: Cluster[];
  trigger: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clusterId, setClusterId] = useState<string>(clusters[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDescription("");
    setClusterId(clusters[0]?.id ?? "");
    setError(null);
  }

  const create = useMutation({
    mutationFn: () =>
      projectsApi.create(teamId, {
        name: name.trim(),
        cluster_id: clusterId,
        description: description.trim() || undefined,
      }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects", teamId] });
      setOpen(false);
      reset();
      router.push(`/projects/${project.id}/overview`);
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not create the project.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Project name is required.");
    if (!clusterId)   return setError("Pick a cluster.");
    create.mutate();
  }

  const hasClusters = clusters.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogEyebrow>Workloads · project</DialogEyebrow>
            <DialogTitle>Create a project</DialogTitle>
            <DialogDescription>
              Projects group apps that share a cluster, environments, and secrets. Pick the
              cluster they live on — the rest is configured per-app.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {error && <Alert tone="error">{error}</Alert>}
            {!hasClusters && (
              <Alert tone="warn" title="No clusters">
                Projects need a cluster.{" "}
                <Link href="/clusters" className="text-signal hover:underline underline-offset-4">
                  Create one
                </Link>
                {" "}— then come back.
              </Alert>
            )}
            <Field id="project-name" label="Project name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                autoComplete="off"
                placeholder="orbit"
                maxLength={64}
              />
            </Field>
            <Field id="project-desc" label="Description" hint="Optional.">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoComplete="off"
                placeholder="Public-facing edge services"
                maxLength={200}
              />
            </Field>
            <div className="space-y-2">
              <div className="label-mono">Cluster</div>
              <Select value={clusterId} onValueChange={setClusterId} disabled={!hasClusters}>
                <SelectTrigger>
                  <SelectValue placeholder={hasClusters ? "Pick a cluster" : "No clusters yet"} />
                </SelectTrigger>
                <SelectContent>
                  {clusters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="inline-flex items-center gap-2">
                        <Network className="h-3 w-3 text-ink-3" />
                        <span>{c.name}</span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 ml-1">
                          {c.region || c.slug}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[12px] text-ink-3">
                Apps in this project deploy onto cluster members per the placement strategy.
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending} disabled={!hasClusters}>
              Create project <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
