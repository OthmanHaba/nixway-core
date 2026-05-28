"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, KeySquare } from "lucide-react";
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
import { cn } from "@/lib/cn";

const COMMON_ENVS = ["production", "staging", "preview", "development"];

export function CreateSecretDialog({
  teamId,
  defaultEnvironment,
  trigger,
}: {
  teamId: string;
  defaultEnvironment?: string;
  trigger: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [environment, setEnvironment] = useState(defaultEnvironment || "production");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEnvironment(defaultEnvironment || "production");
    setKey("");
    setValue("");
    setError(null);
  }

  const create = useMutation({
    mutationFn: () =>
      secretsApi.create(teamId, {
        environment: environment.trim() || "production",
        key: key.trim(),
        value,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-secrets", teamId] });
      setOpen(false);
      reset();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not create the secret.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!key.trim()) return setError("Key is required.");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key.trim())) {
      return setError("Keys must start with a letter or underscore and contain only letters, digits, and underscores.");
    }
    if (!value) return setError("Value is required.");
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
            <DialogEyebrow>Access · secret</DialogEyebrow>
            <DialogTitle>Add a secret</DialogTitle>
            <DialogDescription>
              We encrypt the value with AES-GCM and store only the ciphertext. Apps in matching
              environments receive the secret as an environment variable at deploy time.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {error && <Alert tone="error">{error}</Alert>}
            <div className="space-y-2">
              <div className="label-mono">Environment</div>
              <Input
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                placeholder="production"
                autoComplete="off"
                maxLength={64}
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {COMMON_ENVS.map((env) => (
                  <button
                    key={env}
                    type="button"
                    onClick={() => setEnvironment(env)}
                    className={cn(
                      "font-mono uppercase tracking-[0.14em] text-[10px] px-2 py-0.5 rounded-[3px] border transition-colors",
                      environment === env
                        ? "border-signal text-[color:var(--signal-ink)] bg-[color:var(--signal-soft)]"
                        : "border-line-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1",
                    )}
                  >
                    {env}
                  </button>
                ))}
              </div>
            </div>
            <Field
              id="secret-key"
              label="Key"
              hint="Convention: SCREAMING_SNAKE_CASE."
            >
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                autoComplete="off"
                placeholder="DATABASE_URL"
                maxLength={128}
              />
            </Field>
            <Field
              id="secret-value"
              label="Value"
              hint="The value is encrypted at rest. After creating, you can reveal it exactly once."
            >
              <Input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
                autoComplete="off"
                placeholder="•••••"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending}>
              <KeySquare className="h-3.5 w-3.5" /> Add secret <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
