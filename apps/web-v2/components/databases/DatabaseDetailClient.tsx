"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Box,
  Check,
  Copy,
  Eye,
  EyeOff,
  Link as LinkIcon,
  Pause,
  Play,
  Plus,
  RotateCw,
  SquareTerminal,
  Trash2,
  TriangleAlert,
  Undo2,
  Unlink,
} from "lucide-react";
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
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/primitives/Select";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { Badge } from "@/components/primitives/Badge";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/primitives/Table";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { databasesApi, ApiError } from "@/lib/api";
import type {
  App,
  Database,
  DatabaseBackup,
  DatabaseCredentialRotation,
  DatabaseLink,
  RotateCredentialsResponse,
} from "@/lib/types";
import { cn } from "@/lib/cn";

interface Props {
  projectId: string;
  initialDatabase: Database;
  initialLinks: DatabaseLink[];
  initialRotations: DatabaseCredentialRotation[];
  initialBackups: DatabaseBackup[];
  projectApps: App[];
}

export function DatabaseDetailClient({
  projectId,
  initialDatabase,
  initialLinks,
  initialRotations,
  initialBackups,
  projectApps,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<RotateCredentialsResponse | null>(null);

  const databaseQ = useQuery({
    queryKey: ["database", initialDatabase.id],
    queryFn: () => databasesApi.get(projectId, initialDatabase.id),
    initialData: initialDatabase,
    refetchInterval: 15_000,
  });
  const db = databaseQ.data ?? initialDatabase;

  const linksQ = useQuery({
    queryKey: ["database-links", initialDatabase.id],
    queryFn: () => databasesApi.listLinks(projectId, initialDatabase.id),
    initialData: initialLinks,
  });
  const rotationsQ = useQuery({
    queryKey: ["database-rotations", initialDatabase.id],
    queryFn: () => databasesApi.listRotations(projectId, initialDatabase.id),
    initialData: initialRotations,
  });
  const backupsQ = useQuery({
    queryKey: ["database-backups", initialDatabase.id],
    queryFn: () => databasesApi.listBackups(projectId, initialDatabase.id),
    initialData: initialBackups,
    refetchInterval: 10_000,
  });

  const start = useMutation({
    mutationFn: () => databasesApi.start(projectId, db.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["database", db.id] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not start."),
  });
  const stop = useMutation({
    mutationFn: () => databasesApi.stop(projectId, db.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["database", db.id] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not stop."),
  });
  const unlink = useMutation({
    mutationFn: (linkId: string) => databasesApi.unlink(projectId, db.id, linkId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["database-links", db.id] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not unlink app."),
  });
  const remove = useMutation({
    mutationFn: () => databasesApi.remove(projectId, db.id),
    onSuccess: () => {
      router.push(`/projects/${projectId}/databases`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not delete."),
  });
  const rotate = useMutation({
    mutationFn: () => databasesApi.rotate(projectId, db.id),
    onSuccess: (res) => {
      setError(null);
      setRotated(res);
      queryClient.invalidateQueries({ queryKey: ["database-rotations", db.id] });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Rotation failed."),
  });
  const createBackup = useMutation({
    mutationFn: () => databasesApi.createBackup(projectId, db.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["database-backups", db.id] }),
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not start backup."),
  });
  const removeBackup = useMutation({
    mutationFn: (backupId: string) =>
      databasesApi.removeBackup(projectId, db.id, backupId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["database-backups", db.id] }),
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not delete backup."),
  });
  const restoreBackup = useMutation({
    mutationFn: (input: { backup_id: string; target: "in_place" | "new"; new_name?: string }) =>
      databasesApi.restore(projectId, db.id, input),
    onSuccess: (res) => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["database", db.id] });
      // "new" mode created a different DB — surface it via navigation.
      if (res.database.id !== db.id) {
        router.push(`/projects/${projectId}/databases/${res.database.id}`);
      }
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Restore failed."),
  });

  const links = linksQ.data ?? [];
  const rotations = rotationsQ.data ?? [];
  const backups = backupsQ.data ?? [];

  // App index for showing names on the links table.
  const appsById = new Map(projectApps.map((a) => [a.id, a]));
  const linkableApps = projectApps.filter((a) => !links.some((l) => l.app_id === a.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="label-mono mb-1">{db.template_slug} · {db.version}</div>
          <h1 className="text-[22px] text-ink-1 font-mono">{db.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={dbTone(db.status)} dot={db.status === "running"}>
              {db.status}
            </Badge>
            <span className="font-mono text-[10px] text-ink-4 num">port {db.port}</span>
            <span className="font-mono text-[10px] text-ink-4">{db.container_name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/databases/${db.id}/query`}
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-line-1 bg-surface-1 text-ink-2 hover:text-ink-1 hover:bg-surface-2 font-mono uppercase tracking-[0.14em] text-[11px] transition-colors"
          >
            <SquareTerminal className="h-3.5 w-3.5" /> Console
          </Link>
          {db.status === "stopped" ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => start.mutate()}
              loading={start.isPending}
            >
              <Play className="h-3.5 w-3.5" /> Start
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => stop.mutate()}
              loading={stop.isPending}
              disabled={db.status !== "running"}
            >
              <Pause className="h-3.5 w-3.5" /> Stop
            </Button>
          )}
          <ConfirmDialog
            destructive
            title={`Rotate credentials for ${db.name}?`}
            description={
              <>
                Generates a new app-user password, restarts the database, and triggers a
                redeploy of every linked app so they pick up the new env. The plaintext
                password is shown <span className="text-ink-1">once</span> after rotation
                — store it before closing the banner.
              </>
            }
            confirmLabel="Rotate now"
            onConfirm={() =>
              new Promise<void>((resolve, reject) =>
                rotate.mutate(undefined, {
                  onSuccess: () => resolve(),
                  onError: (e) => reject(e),
                }),
              )
            }
            trigger={
              <Button type="button" variant="secondary" loading={rotate.isPending}>
                <RotateCw className="h-3.5 w-3.5" /> Rotate
              </Button>
            }
          />
          <ConfirmDialog
            destructive
            title={`Delete ${db.name}?`}
            confirmPhrase={db.name}
            description={
              <>
                Permanently removes the container and its persistent volume.{" "}
                <span className="text-ink-1">Data is destroyed and cannot be recovered.</span>{" "}
                Type the database name to confirm.
              </>
            }
            confirmLabel="Delete database"
            onConfirm={() =>
              new Promise<void>((resolve, reject) =>
                remove.mutate(undefined, {
                  onSuccess: () => resolve(),
                  onError: (e) => reject(e),
                }),
              )
            }
            trigger={
              <Button type="button" variant="ghost" loading={remove.isPending} className="text-alert">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            }
          />
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {rotated && (
        <RotatedBanner
          response={rotated}
          onDismiss={() => setRotated(null)}
        />
      )}

      {/* Connection card */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1">Connection</div>
          <h2 className="text-[16px] text-ink-1">In-cluster reachability</h2>
          <p className="mt-1 text-[12px] text-ink-3 max-w-md">
            Linked apps receive these as environment variables under the chosen prefix.
            From outside the mesh, port-forward via <span className="font-mono text-ink-2">nixway db port-forward</span>.
          </p>
        </CardHeader>
        <CardBody className="space-y-3">
          <KvRow label="Host" value={db.dns_record || db.container_name} />
          <KvRow label="Port" value={String(db.port)} />
          <KvRow label="Container" value={db.container_name} />
          <KvRow label="Resources" value={`${db.resource_cpu_millicores}m CPU · ${db.resource_memory_mb} MiB`} />
          {db.backup_schedule && (
            <KvRow
              label="Backups"
              value={`${db.backup_schedule} · keep ${db.backup_retention_days ?? "?"}d`}
            />
          )}
        </CardBody>
      </Card>

      {/* Linked apps */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="label-mono mb-1">App links</div>
              <h2 className="text-[16px] text-ink-1">Connected workloads</h2>
              <p className="mt-1 text-[12px] text-ink-3 max-w-md">
                Linking injects DSN env vars at deploy time. Unlink to stop emitting them on
                the next deployment.
              </p>
            </div>
            <LinkAppDialog
              projectId={projectId}
              dbId={db.id}
              eligibleApps={linkableApps}
              trigger={
                <Button disabled={linkableApps.length === 0}>
                  <Plus className="h-3.5 w-3.5" /> Link app
                </Button>
              }
            />
          </div>
        </CardHeader>
        <CardBody>
          {links.length === 0 ? (
            <EmptyState
              icon={<LinkIcon className="h-4 w-4" />}
              title="No apps linked"
              body="Link an app from this project to start injecting connection env vars on every deploy."
            />
          ) : (
            <ul className="rounded-[var(--radius-md)] border border-line-1 divide-y divide-line-1 bg-surface-1 overflow-hidden">
              {links.map((l) => {
                const a = appsById.get(l.app_id);
                return (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="font-mono text-[12px] text-ink-1 truncate">
                        {a?.name ?? l.app_id.slice(0, 8)}
                      </div>
                      <div className="font-mono text-[10px] text-ink-4">
                        env prefix · <span className="text-ink-2">{l.env_prefix || "(none)"}</span>
                      </div>
                    </div>
                    <ConfirmDialog
                      destructive
                      title="Unlink this app?"
                      description={
                        <>
                          Removes the env injection for{" "}
                          <span className="text-ink-1">{a?.name ?? "the app"}</span>. The app
                          stops receiving DB env vars on its next deployment.
                        </>
                      }
                      confirmLabel="Unlink"
                      onConfirm={() =>
                        new Promise<void>((resolve, reject) =>
                          unlink.mutate(l.id, {
                            onSuccess: () => resolve(),
                            onError: (e) => reject(e),
                          }),
                        )
                      }
                      trigger={
                        <Button type="button" variant="ghost" size="sm" loading={unlink.isPending}>
                          <Unlink className="h-3.5 w-3.5" /> Unlink
                        </Button>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Backups */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="label-mono mb-1 inline-flex items-center gap-2">
                <Archive className="h-3 w-3" /> Snapshots
              </div>
              <h2 className="text-[16px] text-ink-1">Backups</h2>
              <p className="mt-1 text-[12px] text-ink-3 max-w-md">
                Point-in-time dumps you can restore in place or onto a fresh DB. Manual
                snapshots run alongside any scheduled backups.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => createBackup.mutate()}
              loading={createBackup.isPending}
              disabled={db.status !== "running"}
            >
              <Archive className="h-3.5 w-3.5" /> Create backup
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {backups.length === 0 ? (
            <EmptyState
              icon={<Archive className="h-4 w-4" />}
              title="No backups yet"
              body="Trigger a manual backup once the database is running, or set a schedule when you provisioned it."
            />
          ) : (
            <div className="rounded-[var(--radius-md)] border border-line-1 bg-surface-1 overflow-hidden">
              <Table>
                <THead>
                  <TR>
                    <TH>Type</TH>
                    <TH>Status</TH>
                    <TH>Size</TH>
                    <TH>Started</TH>
                    <TH>Completed</TH>
                    <TH>Tool</TH>
                    <TH align="right" className="w-44"> </TH>
                  </TR>
                </THead>
                <TBody>
                  {backups.map((b) => {
                    const restorable = b.status === "completed";
                    return (
                      <TR key={b.id}>
                        <TD>
                          <Badge tone={b.type === "scheduled" ? "signal" : "outline"}>
                            {b.type}
                          </Badge>
                        </TD>
                        <TD>
                          <Badge tone={backupTone(b.status)} dot={b.status === "running"}>
                            {b.status}
                          </Badge>
                        </TD>
                        <TD>
                          <span className="font-mono text-[12px] text-ink-1 num">
                            {formatBytes(b.size_bytes)}
                          </span>
                        </TD>
                        <TD>
                          <span className="font-mono text-[11px] text-ink-3 num">
                            {formatWhen(b.started_at)}
                          </span>
                        </TD>
                        <TD>
                          <span className="font-mono text-[11px] text-ink-3 num">
                            {b.completed_at ? formatWhen(b.completed_at) : "—"}
                          </span>
                        </TD>
                        <TD>
                          <span className="font-mono text-[10px] text-ink-4">
                            {b.backup_tool || "—"}
                          </span>
                        </TD>
                        <TD align="right">
                          <div className="inline-flex items-center gap-1">
                            {b.error && (
                              <span
                                className="font-mono text-[10px] text-alert truncate max-w-[140px]"
                                title={b.error}
                              >
                                <TriangleAlert className="h-3 w-3 inline" /> {b.error}
                              </span>
                            )}
                            <RestoreDialog
                              backup={b}
                              dbName={db.name}
                              disabled={!restorable}
                              loading={
                                restoreBackup.isPending &&
                                restoreBackup.variables?.backup_id === b.id
                              }
                              onRestore={(target, new_name) =>
                                new Promise<void>((resolve, reject) =>
                                  restoreBackup.mutate(
                                    { backup_id: b.id, target, new_name },
                                    {
                                      onSuccess: () => resolve(),
                                      onError: (e) => reject(e),
                                    },
                                  ),
                                )
                              }
                            />
                            <ConfirmDialog
                              destructive
                              title="Delete this backup?"
                              description={
                                <>
                                  Removes the dump from object storage. Other backups for{" "}
                                  <span className="text-ink-1">{db.name}</span> are
                                  unaffected.
                                </>
                              }
                              confirmLabel="Delete backup"
                              onConfirm={() =>
                                new Promise<void>((resolve, reject) =>
                                  removeBackup.mutate(b.id, {
                                    onSuccess: () => resolve(),
                                    onError: (e) => reject(e),
                                  }),
                                )
                              }
                              trigger={
                                <button
                                  type="button"
                                  aria-label="Delete backup"
                                  className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-alert hover:bg-surface-2 transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              }
                            />
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Rotations */}
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <div className="label-mono mb-1">Audit</div>
            <h2 className="text-[18px] text-ink-1">Credential rotations</h2>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
            {rotations.length} {rotations.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        {rotations.length === 0 ? (
          <EmptyState
            icon={<RotateCw className="h-4 w-4" />}
            title="No rotations yet"
            body="Rotate the database credentials to generate a new app-user password and redeploy linked apps."
          />
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Status</TH>
                  <TH>Apps restarted</TH>
                  <TH>Completed</TH>
                  <TH>Error</TH>
                </TR>
              </THead>
              <TBody>
                {rotations.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3 num">
                        {formatWhen(r.created_at)}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={rotationTone(r.status)}>{r.status}</Badge>
                    </TD>
                    <TD>
                      <span className="font-mono text-[12px] text-ink-1 num">
                        {r.linked_apps_restarted}
                      </span>
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3 num">
                        {r.completed_at ? formatWhen(r.completed_at) : "—"}
                      </span>
                    </TD>
                    <TD>
                      {r.error ? (
                        <span className="text-[12px] text-alert inline-flex items-center gap-1">
                          <TriangleAlert className="h-3 w-3" /> {r.error}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function KvRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-1 last:border-b-0 pb-2 last:pb-0">
      <dt className="label-mono">{label}</dt>
      <dd className="font-mono text-[12px] text-ink-1 truncate">{value}</dd>
    </div>
  );
}

function LinkAppDialog({
  projectId,
  dbId,
  eligibleApps,
  trigger,
}: {
  projectId: string;
  dbId: string;
  eligibleApps: App[];
  trigger: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState(eligibleApps[0]?.id ?? "");
  const [envPrefix, setEnvPrefix] = useState("DATABASE_");
  const [error, setError] = useState<string | null>(null);

  const link = useMutation({
    mutationFn: () =>
      databasesApi.link(projectId, dbId, {
        app_id: appId,
        env_prefix: envPrefix.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["database-links", dbId] });
      setOpen(false);
      setError(null);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not link app."),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>Services · link</DialogEyebrow>
          <DialogTitle>Link an app</DialogTitle>
          <DialogDescription>
            The app will receive connection env vars on its next deployment, prefixed with
            the value below.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="space-y-2">
            <div className="label-mono">App</div>
            <Select value={appId} onValueChange={setAppId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick an app" />
              </SelectTrigger>
              <SelectContent>
                {eligibleApps.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="inline-flex items-center gap-2">
                      <Box className="h-3 w-3 text-ink-3" />
                      <span className="font-mono text-[12px]">{a.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field
            id="link-prefix"
            label="Env prefix"
            hint="Vars are emitted as PREFIX_HOST, PREFIX_PORT, PREFIX_USER, PREFIX_PASSWORD, PREFIX_NAME, PREFIX_URL."
          >
            <Input
              value={envPrefix}
              onChange={(e) => setEnvPrefix(e.target.value)}
              autoComplete="off"
              placeholder="DATABASE_"
              maxLength={64}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => link.mutate()}
            loading={link.isPending}
            disabled={!appId}
          >
            <LinkIcon className="h-3.5 w-3.5" /> Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RotatedBanner({
  response,
  onDismiss,
}: {
  response: RotateCredentialsResponse;
  onDismiss: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--signal)]/40 bg-[color:var(--signal-soft)]/15 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="label-mono inline-flex items-center gap-2">
          <RotateCw className="h-3 w-3" /> Credentials rotated
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="font-mono uppercase tracking-[0.14em] text-[10px] text-ink-3 hover:text-ink-1"
        >
          Dismiss
        </button>
      </div>
      <p className="text-[12px] text-ink-2 max-w-lg">
        The new app-user password is shown <span className="text-ink-1">once</span>. Store it
        immediately — closing this banner discards it.
      </p>
      <div className="flex items-center gap-2">
        <code
          className={cn(
            "flex-1 font-mono text-[12px] text-ink-1 bg-surface-2 border border-line-1 rounded-[var(--radius-sm)] px-3 py-2 truncate",
            !reveal && "tracking-[0.4em]",
          )}
        >
          {reveal ? response.new_password : "•".repeat(Math.min(24, response.new_password.length))}
        </code>
        <Button type="button" variant="ghost" size="sm" onClick={() => setReveal((v) => !v)}>
          {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {reveal ? "Hide" : "Reveal"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(response.new_password);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch {
              /* ignore */
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function RestoreDialog({
  backup,
  dbName,
  disabled,
  loading,
  onRestore,
}: {
  backup: DatabaseBackup;
  dbName: string;
  disabled?: boolean;
  loading?: boolean;
  onRestore: (target: "in_place" | "new", new_name?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"in_place" | "new">("new");
  const [newName, setNewName] = useState(`${dbName}-restored`);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const inPlaceReady = mode !== "in_place" || confirmPhrase.trim() === dbName;
  const newReady = mode !== "new" || newName.trim().length > 0;

  async function run() {
    if (!inPlaceReady || !newReady) return;
    setError(null);
    setPending(true);
    try {
      await onRestore(mode, mode === "new" ? newName.trim() : undefined);
      setOpen(false);
      setConfirmPhrase("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Restore failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setError(null);
          setConfirmPhrase("");
          setMode("new");
          setNewName(`${dbName}-restored`);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} loading={loading}>
          <Undo2 className="h-3.5 w-3.5" /> Restore
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>Backup · restore</DialogEyebrow>
          <DialogTitle>Restore from backup</DialogTitle>
          <DialogDescription>
            Pick a target. In-place restores overwrite the current database&rsquo;s data —
            type the database name below to confirm. New restores provision a fresh copy
            alongside the source.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode("new")}
              className={cn(
                "text-left p-3.5 rounded-[var(--radius-md)] border bg-surface-1 transition-colors",
                mode === "new"
                  ? "border-signal ring-1 ring-signal/40"
                  : "border-line-1 hover:bg-surface-2",
              )}
            >
              <div className="label-mono">Restore to a new DB</div>
              <p className="mt-1 text-[12px] text-ink-3 leading-relaxed">
                Provisions a fresh database with the snapshot. Leaves the current data
                untouched. Recommended.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMode("in_place")}
              className={cn(
                "text-left p-3.5 rounded-[var(--radius-md)] border bg-surface-1 transition-colors",
                mode === "in_place"
                  ? "border-alert ring-1 ring-alert/40"
                  : "border-line-1 hover:bg-surface-2",
              )}
            >
              <div className="label-mono text-alert">Restore in place</div>
              <p className="mt-1 text-[12px] text-ink-3 leading-relaxed">
                Overwrites the current database&rsquo;s data with this snapshot. Linked
                apps may need to redeploy.
              </p>
            </button>
          </div>

          {mode === "new" && (
            <Field id="restore-name" label="New database name">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoComplete="off"
                placeholder={`${dbName}-restored`}
                maxLength={64}
              />
            </Field>
          )}

          {mode === "in_place" && (
            <Field
              id="restore-confirm"
              label={
                <span>
                  Type <span className="font-mono text-ink-1">{dbName}</span> to confirm
                </span>
              }
              hint="This is destructive — the current data is replaced by the snapshot."
            >
              <Input
                value={confirmPhrase}
                onChange={(e) => setConfirmPhrase(e.target.value)}
                autoComplete="off"
              />
            </Field>
          )}

          <p className="font-mono text-[10px] text-ink-4">
            backup id · {backup.id.slice(0, 8)}
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={run}
            loading={pending || loading}
            disabled={!inPlaceReady || !newReady}
          >
            <Undo2 className="h-3.5 w-3.5" /> Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function dbTone(status: string): "online" | "warn" | "alert" | "neutral" | "signal" {
  switch (status) {
    case "running":      return "online";
    case "provisioning": return "signal";
    case "stopped":      return "warn";
    case "error":
    case "deleted":      return "alert";
    default:             return "neutral";
  }
}

function rotationTone(status: string): "online" | "warn" | "alert" | "neutral" | "signal" {
  switch (status) {
    case "completed": return "online";
    case "pending":   return "signal";
    case "failed":    return "alert";
    default:          return "neutral";
  }
}

function backupTone(status: string): "online" | "warn" | "alert" | "neutral" | "signal" {
  switch (status) {
    case "completed": return "online";
    case "running":   return "signal";
    case "failed":    return "alert";
    default:          return "neutral";
  }
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16);
}
