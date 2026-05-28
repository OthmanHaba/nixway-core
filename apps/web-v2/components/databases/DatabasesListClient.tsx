"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Database as DatabaseIcon,
  HardDrive,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Server as ServerIcon,
  Trash2,
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
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { Badge } from "@/components/primitives/Badge";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/primitives/Table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/primitives/DropdownMenu";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { databasesApi, ApiError, type ProvisionDatabaseInput } from "@/lib/api";
import type { Database, Project, Template } from "@/lib/types";

interface Props {
  project: Project;
  initialDatabases: Database[];
  templates: Template[];
}

export function DatabasesListClient({ project, initialDatabases, templates }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const databases = useQuery({
    queryKey: ["project-databases", project.id],
    queryFn: () => databasesApi.list(project.id),
    initialData: initialDatabases,
    refetchInterval: 20_000,
  });

  const start = useMutation({
    mutationFn: (dbId: string) => databasesApi.start(project.id, dbId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-databases", project.id] }),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not start database."),
  });
  const stop = useMutation({
    mutationFn: (dbId: string) => databasesApi.stop(project.id, dbId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-databases", project.id] }),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not stop database."),
  });
  const remove = useMutation({
    mutationFn: (dbId: string) => databasesApi.remove(project.id, dbId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-databases", project.id] }),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not delete database."),
  });

  const list = databases.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="label-mono mb-1">Managed services</div>
          <p className="text-[13px] text-ink-3 max-w-md">
            Provision a database, cache or queue onto the project&rsquo;s cluster. The
            platform manages the container, persistent volume, and credentials.
          </p>
        </div>
        <ProvisionDialog
          project={project}
          templates={templates}
          trigger={
            <Button>
              <Plus className="h-3.5 w-3.5" /> Provision
            </Button>
          }
        />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {list.length === 0 ? (
        <EmptyState
          icon={<DatabaseIcon className="h-4 w-4" />}
          title="No databases yet"
          body="Provision a managed database to get started — your apps can link to it for automatic env var injection."
          action={
            <ProvisionDialog
              project={project}
              templates={templates}
              trigger={
                <Button>
                  <Plus className="h-3.5 w-3.5" /> Provision database
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
                <TH>Name</TH>
                <TH>Engine</TH>
                <TH>Status</TH>
                <TH>Connection</TH>
                <TH>Resources</TH>
                <TH>Created</TH>
                <TH align="right" className="w-12"> </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <Link
                      href={`/projects/${project.id}/databases/${d.id}`}
                      className="inline-flex items-center gap-2.5 hover:text-signal transition-colors"
                    >
                      <DatabaseIcon className="h-3.5 w-3.5 text-ink-3" />
                      <span className="font-mono text-[12px] text-ink-1">{d.name}</span>
                    </Link>
                  </TD>
                  <TD>
                    <span className="font-mono text-[12px] text-ink-1">{d.template_slug}</span>
                    <span className="font-mono text-[11px] text-ink-3 ml-1">{d.version}</span>
                  </TD>
                  <TD>
                    <Badge tone={dbTone(d.status)} dot={d.status === "running"}>
                      {d.status}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="font-mono text-[11px] text-ink-2 truncate max-w-[220px]">
                      {d.dns_record || d.container_name}
                    </div>
                    <div className="font-mono text-[10px] text-ink-4 num">port {d.port}</div>
                  </TD>
                  <TD>
                    <span className="font-mono text-[10px] text-ink-3 num">
                      {d.resource_cpu_millicores}m · {d.resource_memory_mb}Mi
                    </span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-3 num">
                      {formatDate(d.created_at)}
                    </span>
                  </TD>
                  <TD align="right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                          aria-label="Database actions"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>{d.name}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {d.status === "stopped" ? (
                          <DropdownMenuItem onSelect={() => start.mutate(d.id)}>
                            <Play className="h-3.5 w-3.5 text-ink-3" /> Start
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() => stop.mutate(d.id)}
                            disabled={d.status !== "running"}
                          >
                            <Pause className="h-3.5 w-3.5 text-ink-3" /> Stop
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <ConfirmDialog
                          destructive
                          title={`Delete ${d.name}?`}
                          confirmPhrase={d.name}
                          description={
                            <>
                              This will permanently remove the database container and its
                              persistent volume. <span className="text-ink-1">Data is
                              destroyed and cannot be recovered.</span> Type the database name
                              below to confirm.
                            </>
                          }
                          confirmLabel="Delete database"
                          onConfirm={() =>
                            new Promise<void>((resolve, reject) =>
                              remove.mutate(d.id, {
                                onSuccess: () => resolve(),
                                onError: (e) => reject(e),
                              }),
                            )
                          }
                          trigger={
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
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

function ProvisionDialog({
  project,
  templates,
  trigger,
}: {
  project: Project;
  templates: Template[];
  trigger: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Group templates by category for the picker.
  const grouped = useMemo(() => {
    const out: Record<string, Template[]> = {};
    for (const t of templates) (out[t.category] ??= []).push(t);
    return out;
  }, [templates]);

  const firstSlug = templates[0]?.slug ?? "";
  const [slug, setSlug] = useState(firstSlug);
  const tmpl = templates.find((t) => t.slug === slug);
  const defaultVersion = tmpl?.versions.find((v) => v.default)?.version ?? tmpl?.versions[0]?.version ?? "";

  const [version, setVersion] = useState(defaultVersion);
  const [name, setName] = useState("");
  const [size, setSize] = useState(String(tmpl?.volume_spec.default_gib ?? 10));
  const [cpu, setCpu] = useState(String(tmpl?.default_resources.milli_cpu ?? 500));
  const [memory, setMemory] = useState(String(tmpl?.default_resources.memory_mb ?? 512));
  const [schedule, setSchedule] = useState("");
  const [retention, setRetention] = useState("7");
  const [error, setError] = useState<string | null>(null);

  // Reset dependent fields when template changes.
  function selectTemplate(next: string) {
    setSlug(next);
    const t = templates.find((x) => x.slug === next);
    setVersion(t?.versions.find((v) => v.default)?.version ?? t?.versions[0]?.version ?? "");
    setSize(String(t?.volume_spec.default_gib ?? 10));
    setCpu(String(t?.default_resources.milli_cpu ?? 500));
    setMemory(String(t?.default_resources.memory_mb ?? 512));
  }

  function reset() {
    selectTemplate(firstSlug);
    setName("");
    setSchedule("");
    setRetention("7");
    setError(null);
  }

  const create = useMutation({
    mutationFn: () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name is required.");
      if (!slug || !version) throw new Error("Pick a template and version.");
      if (!project.cluster_id) throw new Error("Project has no cluster — assign one first.");
      const input: ProvisionDatabaseInput = {
        cluster_id: project.cluster_id,
        template_slug: slug,
        version,
        name: trimmed,
        size_gb: Number(size) || 0,
        cpu_millicores: Number(cpu) || 0,
        memory_mb: Number(memory) || 0,
        backup_schedule: schedule.trim() || undefined,
        retention_days: schedule.trim() ? Number(retention) || 0 : undefined,
      };
      return databasesApi.provision(project.id, input);
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["project-databases", project.id] });
      setOpen(false);
      reset();
      router.push(`/projects/${project.id}/databases/${created.id}`);
    },
    onError: (err) =>
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not provision database.",
      ),
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
      <DialogContent className="max-w-[680px]">
        <DialogHeader>
          <DialogEyebrow>Services · provision</DialogEyebrow>
          <DialogTitle>Provision database</DialogTitle>
          <DialogDescription>
            The platform pulls the image, attaches a volume, generates credentials and
            registers DNS — usually under a minute for fresh templates.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}
          {templates.length === 0 && (
            <Alert tone="warn">No service templates available on this platform.</Alert>
          )}

          <div className="space-y-2">
            <div className="label-mono">Template</div>
            <Select value={slug} onValueChange={selectTemplate} disabled={templates.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a service" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(grouped).map(([cat, list]) => (
                  <div key={cat}>
                    <div className="px-2 pt-2 pb-1 label-mono text-ink-4">{cat}</div>
                    {list.map((t) => (
                      <SelectItem key={t.slug} value={t.slug}>
                        <span className="inline-flex items-center gap-2">
                          <Box className="h-3 w-3 text-ink-3" />
                          <span className="font-mono text-[12px]">{t.name}</span>
                          <span className="font-mono text-[10px] text-ink-4 ml-1">{t.slug}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
            {tmpl?.description && (
              <p className="text-[12px] text-ink-3">{tmpl.description}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="label-mono">Version</div>
              <Select value={version} onValueChange={setVersion} disabled={!tmpl}>
                <SelectTrigger>
                  <SelectValue placeholder="Version" />
                </SelectTrigger>
                <SelectContent>
                  {tmpl?.versions.map((v) => (
                    <SelectItem key={v.version} value={v.version}>
                      <span className="font-mono text-[12px]">{v.version}</span>
                      {v.default && (
                        <span className="font-mono text-[10px] text-ink-4 ml-1">(default)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Field id="db-name" label="Name" hint="Used as the container name + DNS prefix.">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                placeholder="main-db"
                maxLength={64}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field id="db-size" label="Size (GB)" hint={`mounts at ${tmpl?.volume_spec.mount_path ?? "/data"}`}>
              <Input type="number" min={1} step={1} value={size} onChange={(e) => setSize(e.target.value)} />
            </Field>
            <Field id="db-cpu" label="CPU (m)">
              <Input type="number" min={50} step={50} value={cpu} onChange={(e) => setCpu(e.target.value)} />
            </Field>
            <Field id="db-mem" label="Memory (MiB)">
              <Input type="number" min={64} step={64} value={memory} onChange={(e) => setMemory(e.target.value)} />
            </Field>
          </div>

          <div className="rounded-[var(--radius-md)] border border-line-1 bg-surface-1 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="label-mono">Backups</div>
                <p className="text-[12px] text-ink-3">
                  Optional. Leave the schedule blank to skip automatic backups.
                </p>
              </div>
              <HardDrive className="h-4 w-4 text-ink-3" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
              <Field id="db-schedule" label="Schedule (cron)" hint="e.g. 0 3 * * * for 03:00 UTC daily">
                <Input
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  autoComplete="off"
                  placeholder="0 3 * * *"
                />
              </Field>
              <Field id="db-retention" label="Retention (days)">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={retention}
                  onChange={(e) => setRetention(e.target.value)}
                  disabled={!schedule.trim()}
                />
              </Field>
            </div>
          </div>

          <p className="font-mono text-[11px] text-ink-3 inline-flex items-center gap-2">
            <ServerIcon className="h-3 w-3" /> deploys to cluster
            <span className="text-ink-1">{project.cluster_name ?? project.cluster_id}</span>
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
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!slug || !version || !name.trim()}
          >
            <Plus className="h-3.5 w-3.5" /> Provision
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
