"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Layers } from "lucide-react";
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
import { buildsApi, ApiError } from "@/lib/api";
import type { Environment } from "@/lib/types";

export function TriggerBuildDialog({
  appId,
  environments,
  trigger,
}: {
  appId: string;
  environments: Environment[];
  trigger: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const defaultEnv =
    environments.find((e) => e.is_production)?.id ?? environments[0]?.id ?? "";
  const [envId, setEnvId] = useState<string>(defaultEnv);
  const [branch, setBranch] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEnvId(defaultEnv);
    setBranch("");
    setCommitSha("");
    setError(null);
  }

  const fire = useMutation({
    mutationFn: () =>
      buildsApi.trigger(appId, {
        environment_id: envId || undefined,
        branch: branch.trim() || undefined,
        commit_sha: commitSha.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-builds", appId] });
      setOpen(false);
      reset();
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not trigger build.");
    },
  });

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
        <DialogHeader>
          <DialogEyebrow>Workloads · build</DialogEyebrow>
          <DialogTitle>Trigger a build</DialogTitle>
          <DialogDescription>
            Builders pick up new builds from the queue. Leave branch and commit empty to use
            the app&rsquo;s default branch at HEAD.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="space-y-2">
            <div className="label-mono">Environment</div>
            <Select value={envId} onValueChange={setEnvId} disabled={environments.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={environments.length === 0 ? "No environments" : "Pick environment"} />
              </SelectTrigger>
              <SelectContent>
                {environments.map((env) => (
                  <SelectItem key={env.id} value={env.id}>
                    <span className="inline-flex items-center gap-2">
                      <Layers className="h-3 w-3 text-ink-3" />
                      <span>{env.name}</span>
                      {env.is_production && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal ml-1">
                          prod
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field id="branch" label="Branch" hint="Optional — defaults to the app's branch.">
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                autoComplete="off"
                placeholder="main"
              />
            </Field>
            <Field id="commit" label="Commit SHA" hint="Optional — pins to a specific commit.">
              <Input
                value={commitSha}
                onChange={(e) => setCommitSha(e.target.value)}
                autoComplete="off"
                placeholder="abcd123"
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={() => fire.mutate()} loading={fire.isPending} disabled={!envId}>
            Trigger build <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
