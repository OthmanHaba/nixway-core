"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
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
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { clustersApi, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

const REGION_HINTS = ["us-east", "us-west", "eu-west", "eu-central", "sgp", "syd"];

export function CreateClusterDialog({
  teamId,
  trigger,
}: {
  teamId: string;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [region, setRegion] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDescription("");
    setRegion("");
    setError(null);
  }

  const create = useMutation({
    mutationFn: () =>
      clustersApi.create(teamId, {
        name: name.trim(),
        description: description.trim() || undefined,
        region: region.trim() || undefined,
      }),
    onSuccess: (cluster) => {
      queryClient.invalidateQueries({ queryKey: ["clusters", teamId] });
      setOpen(false);
      reset();
      router.push(`/clusters/${cluster.id}/members`);
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not create the cluster.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Cluster name is required.");
    create.mutate();
  }

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
            <DialogEyebrow>Infrastructure · cluster</DialogEyebrow>
            <DialogTitle>Create a cluster</DialogTitle>
            <DialogDescription>
              A cluster wires servers together into a WireGuard mesh with DNS. The platform
              allocates a private CIDR automatically. Add members from the Members tab.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {error && <Alert tone="error">{error}</Alert>}
            <Field id="cluster-name" label="Cluster name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                autoComplete="off"
                placeholder="atlas"
                maxLength={64}
              />
            </Field>
            <Field id="cluster-desc" label="Description" hint="Optional — what this cluster is for.">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoComplete="off"
                placeholder="Production fleet, multi-region edge"
                maxLength={200}
              />
            </Field>
            <div className="space-y-2">
              <div className="label-mono">Region</div>
              <Input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                autoComplete="off"
                placeholder="us-east"
                maxLength={32}
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {REGION_HINTS.map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => setRegion(hint)}
                    className={cn(
                      "font-mono uppercase tracking-[0.14em] text-[10px] px-2 py-0.5 rounded-[3px] border transition-colors",
                      region === hint
                        ? "border-signal text-[color:var(--signal-ink)] bg-[color:var(--signal-soft)]"
                        : "border-line-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1",
                    )}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending}>
              Create cluster <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
