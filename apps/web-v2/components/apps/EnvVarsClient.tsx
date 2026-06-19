"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, MoreHorizontal, Pencil, Plus, Trash2, Variable } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/primitives/Table";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Alert } from "@/components/primitives/Alert";
import { ConfirmDialog } from "@/components/primitives/Confirm";
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
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/primitives/DropdownMenu";
import { appEnvVarsApi, ApiError } from "@/lib/api";
import type { AppEnvVar, Environment } from "@/lib/types";
import { cn } from "@/lib/cn";

// Reserved keys the platform injects at deploy time. Mirrors the API guard so
// users get immediate feedback instead of a 400.
const RESERVED_KEYS = new Set([
  "PORT", "PLATFORM_PUBLIC_DOMAIN", "PLATFORM_PRIVATE_IP", "PLATFORM_PRIVATE_DOMAIN",
  "CLUSTER_NAME", "PROJECT_NAME", "APP_NAME", "ENVIRONMENT", "DEPLOY_ID", "GIT_SHA",
]);

interface Props {
  appId: string;
  environments: Environment[];
}

export function EnvVarsClient({ appId, environments }: Props) {
  const queryClient = useQueryClient();

  // Per-environment scope. Default to production, else the first environment.
  const envSlugs = environments.length
    ? environments.map((e) => e.slug)
    : ["production"];
  const [envSlug, setEnvSlug] = useState<string>(
    envSlugs.includes("production") ? "production" : envSlugs[0],
  );

  const vars = useQuery({
    queryKey: ["app-env-vars", appId, envSlug],
    queryFn: () => appEnvVarsApi.list(appId, envSlug),
  });

  const remove = useMutation({
    mutationFn: ({ varId }: { varId: string }) => appEnvVarsApi.remove(appId, varId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["app-env-vars", appId] }),
  });

  const list = vars.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="label-mono mb-1">App environment</div>
          <p className="text-[13px] text-ink-3 max-w-md">
            Per-app variables for this environment. They override matching team secrets and are
            injected at deploy time. Changing them redeploys the app automatically.
          </p>
        </div>
        <EnvVarDialog
          appId={appId}
          environment={envSlug}
          trigger={
            <Button>
              <Plus className="h-3.5 w-3.5" /> Add variable
            </Button>
          }
        />
      </div>

      {/* environment scope strip */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label-mono mr-2">Environment</span>
        {envSlugs.map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => setEnvSlug(slug)}
            className={cn(
              "font-mono uppercase tracking-[0.14em] text-[10px] px-2 py-0.5 rounded-[3px] border transition-colors",
              envSlug === slug
                ? "border-signal text-[color:var(--signal-ink)] bg-[color:var(--signal-soft)]"
                : "border-line-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1",
            )}
          >
            {slug}
          </button>
        ))}
      </div>

      {vars.error && <Alert tone="error">{errorMessage(vars.error)}</Alert>}
      {remove.error && <Alert tone="error">{errorMessage(remove.error)}</Alert>}

      {list.length === 0 ? (
        <EmptyState
          icon={<Variable className="h-4 w-4" />}
          title={`No variables in ${envSlug}`}
          body="Add an environment variable for this app and environment. Values are encrypted at rest and injected when the app deploys."
          action={
            <EnvVarDialog
              appId={appId}
              environment={envSlug}
              trigger={
                <Button>
                  <Plus className="h-3.5 w-3.5" /> Add variable
                </Button>
              }
            />
          }
        />
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Key</TH>
                <TH>Updated</TH>
                <TH align="right" className="w-12"> </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((v) => (
                <TR key={v.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <Variable className="h-3.5 w-3.5 text-ink-3" />
                      <span className="font-mono text-[12px] text-ink-1">{v.key}</span>
                    </div>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-3 num">{formatDate(v.updated_at)}</span>
                  </TD>
                  <TD align="right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                          aria-label="Variable actions"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuLabel>{v.key}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <RevealEnvVarDialog
                          appId={appId}
                          envVar={v}
                          trigger={
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                              <Eye className="h-3.5 w-3.5 text-ink-3" />
                              Reveal value
                            </DropdownMenuItem>
                          }
                        />
                        <EnvVarDialog
                          appId={appId}
                          environment={envSlug}
                          existing={v}
                          trigger={
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                              <Pencil className="h-3.5 w-3.5 text-ink-3" />
                              Edit value
                            </DropdownMenuItem>
                          }
                        />
                        <DropdownMenuSeparator />
                        <ConfirmDialog
                          destructive
                          title="Delete this variable?"
                          description={
                            <>
                              Removes <span className="text-ink-1">{v.key}</span> from{" "}
                              <span className="text-ink-1">{envSlug}</span>. The app redeploys
                              without it.
                            </>
                          }
                          confirmLabel="Delete variable"
                          onConfirm={() =>
                            new Promise<void>((resolve, reject) =>
                              remove.mutate(
                                { varId: v.id },
                                { onSuccess: () => resolve(), onError: (e) => reject(e) },
                              ),
                            )
                          }
                          trigger={
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              disabled={remove.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-alert" />
                              <span className="text-alert">Delete</span>
                            </DropdownMenuItem>
                          }
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * Create or edit a variable. When `existing` is passed the key is locked and
 * only the value is updated; otherwise a new key is created.
 */
function EnvVarDialog({
  appId,
  environment,
  existing,
  trigger,
}: {
  appId: string;
  environment: string;
  existing?: AppEnvVar;
  trigger: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(existing?.key ?? "");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!existing;

  function reset() {
    setKey(existing?.key ?? "");
    setValue("");
    setError(null);
  }

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? appEnvVarsApi.update(appId, existing!.id, value)
        : appEnvVarsApi.create(appId, { environment, key: key.trim(), value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-env-vars", appId] });
      setOpen(false);
      reset();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not save the variable.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isEdit) {
      const k = key.trim();
      if (!k) return setError("Key is required.");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
        return setError("Keys must start with a letter or underscore and contain only letters, digits, and underscores.");
      }
      if (RESERVED_KEYS.has(k)) {
        return setError(`${k} is reserved by the platform and is set automatically.`);
      }
    }
    if (!value) return setError("Value is required.");
    save.mutate();
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
            <DialogEyebrow>App · {environment}</DialogEyebrow>
            <DialogTitle>{isEdit ? `Edit ${existing!.key}` : "Add a variable"}</DialogTitle>
            <DialogDescription>
              Stored encrypted and injected at deploy time. Saving redeploys the app so the change
              takes effect.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {error && <Alert tone="error">{error}</Alert>}
            <Field id="env-var-key" label="Key" hint="Convention: SCREAMING_SNAKE_CASE.">
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                disabled={isEdit}
                autoComplete="off"
                placeholder="API_BASE_URL"
                maxLength={128}
              />
            </Field>
            <Field
              id="env-var-value"
              label="Value"
              hint="Encrypted at rest. You can reveal or change it later."
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
            <Button type="submit" loading={save.isPending}>
              {isEdit ? "Save value" : "Add variable"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reveal the decrypted value on demand. */
function RevealEnvVarDialog({
  appId,
  envVar,
  trigger,
}: {
  appId: string;
  envVar: AppEnvVar;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const reveal = useMutation({
    mutationFn: () => appEnvVarsApi.reveal(appId, envVar.id),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) reveal.mutate();
        else reveal.reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>App · variable</DialogEyebrow>
          <DialogTitle>{envVar.key}</DialogTitle>
          <DialogDescription>The decrypted value for this environment.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {reveal.error && <Alert tone="error">{errorMessage(reveal.error)}</Alert>}
          <Input
            readOnly
            value={reveal.data?.value ?? ""}
            placeholder={reveal.isPending ? "Decrypting…" : ""}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono"
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
