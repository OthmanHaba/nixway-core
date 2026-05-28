"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
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
import { secretsApi, ApiError } from "@/lib/api";
import type { Secret } from "@/lib/types";

export function RotateSecretDialog({
  teamId,
  secret,
  trigger,
}: {
  teamId: string;
  secret: Secret;
  trigger: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rotate = useMutation({
    mutationFn: () => secretsApi.update(teamId, secret.id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-secrets", teamId] });
      setOpen(false);
      setValue("");
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not rotate the secret.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!value) return setError("New value is required.");
    rotate.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) { setError(null); setValue(""); }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogEyebrow>Access · rotate</DialogEyebrow>
            <DialogTitle>Rotate secret</DialogTitle>
            <DialogDescription>
              Replaces the value of <span className="font-mono text-ink-1">{secret.key}</span> in
              the <span className="font-mono text-ink-1">{secret.environment}</span> environment.
              Deployments that already pulled the old value keep running until next deploy.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {error && <Alert tone="error">{error}</Alert>}
            <Field id="rotate-value" label="New value" hint="Becomes version + 1 on save.">
              <Input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
                autoFocus
                autoComplete="off"
                placeholder="•••••"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={rotate.isPending}>
              <KeyRound className="h-3.5 w-3.5" /> Rotate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
