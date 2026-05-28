"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Box,
  Camera,
  HardDrive,
  Link as LinkIcon,
  Maximize2,
  MoreHorizontal,
  Plus,
  Server as ServerIcon,
  Trash2,
  TriangleAlert,
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
import { volumesApi, ApiError } from "@/lib/api";
import type { Cluster, Server, Volume, VolumeSnapshot } from "@/lib/types";
import { cn } from "@/lib/cn";

interface Props {
  teamId: string;
  initialVolumes: Volume[];
  clusters: Cluster[];
  servers: Server[];
}

export function VolumesClient({ teamId, initialVolumes, clusters, servers }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const volumes = useQuery({
    queryKey: ["volumes", teamId],
    queryFn: () => volumesApi.list(teamId),
    initialData: initialVolumes,
    refetchInterval: 15_000,
  });

  const detach = useMutation({
    mutationFn: (id: string) => volumesApi.detach(teamId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["volumes", teamId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not detach."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => volumesApi.remove(teamId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["volumes", teamId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not delete."),
  });

  const list = volumes.data ?? [];
  const serversById = useMemo(() => new Map(servers.map((s) => [s.id, s])), [servers]);
  const clustersById = useMemo(() => new Map(clusters.map((c) => [c.id, c])), [clusters]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="label-mono mb-1">Persistent storage</div>
          <p className="text-[13px] text-ink-3 max-w-md">
            Block volumes mounted into containers on a cluster member. Survive container
            restarts and can be moved between servers in the same cluster.
          </p>
        </div>
        <CreateVolumeDialog
          teamId={teamId}
          clusters={clusters}
          servers={servers}
          trigger={
            <Button>
              <Plus className="h-3.5 w-3.5" /> Create volume
            </Button>
          }
        />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {list.length === 0 ? (
        <EmptyState
          icon={<HardDrive className="h-4 w-4" />}
          title="No volumes yet"
          body="Create a volume to attach to an app container at a specific mount path."
          action={
            <CreateVolumeDialog
              teamId={teamId}
              clusters={clusters}
              servers={servers}
              trigger={
                <Button>
                  <Plus className="h-3.5 w-3.5" /> Create first volume
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
                <TH>Status</TH>
                <TH>Usage</TH>
                <TH>Server</TH>
                <TH>Mount</TH>
                <TH>FS</TH>
                <TH align="right" className="w-12"> </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((v) => {
                const server = serversById.get(v.server_id);
                const cluster = clustersById.get(v.cluster_id);
                return (
                  <TR key={v.id}>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <HardDrive className="h-3.5 w-3.5 text-ink-3" />
                        <div className="min-w-0">
                          <div className="font-mono text-[12px] text-ink-1 truncate">
                            {v.name}
                          </div>
                          {cluster && (
                            <div className="font-mono text-[10px] text-ink-4 truncate">
                              cluster · {cluster.name}
                            </div>
                          )}
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={volumeTone(v.status)} dot={v.status === "attached"}>
                        {v.status}
                      </Badge>
                    </TD>
                    <TD>
                      <UsageMeter usedBytes={v.used_bytes} sizeGb={v.size_gb} />
                    </TD>
                    <TD>
                      <div className="inline-flex items-center gap-1.5">
                        <ServerIcon className="h-3 w-3 text-ink-3" />
                        <span className="font-mono text-[11px] text-ink-2 truncate max-w-[140px]">
                          {server?.name ?? v.server_id.slice(0, 8)}
                        </span>
                      </div>
                    </TD>
                    <TD>
                      {v.container_name ? (
                        <div className="min-w-0">
                          <div className="font-mono text-[11px] text-ink-1 truncate max-w-[180px]">
                            {v.mount_path ?? "—"}
                          </div>
                          <div className="font-mono text-[10px] text-ink-4 truncate max-w-[180px]">
                            on {v.container_name}
                          </div>
                        </div>
                      ) : (
                        <span className="font-mono text-[10px] text-ink-4">unattached</span>
                      )}
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3">{v.filesystem || "—"}</span>
                    </TD>
                    <TD align="right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                            aria-label="Volume actions"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuLabel>{v.name}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {v.status === "attached" ? (
                            <DropdownMenuItem onSelect={() => detach.mutate(v.id)}>
                              <Unlink className="h-3.5 w-3.5 text-ink-3" /> Detach
                            </DropdownMenuItem>
                          ) : (
                            <AttachDialog
                              teamId={teamId}
                              volume={v}
                              trigger={
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                  <LinkIcon className="h-3.5 w-3.5 text-ink-3" /> Attach
                                </DropdownMenuItem>
                              }
                            />
                          )}
                          <ResizeDialog
                            teamId={teamId}
                            volume={v}
                            trigger={
                              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                <Maximize2 className="h-3.5 w-3.5 text-ink-3" /> Resize
                              </DropdownMenuItem>
                            }
                          />
                          <MoveDialog
                            teamId={teamId}
                            volume={v}
                            servers={servers.filter(
                              (s) => s.id !== v.server_id && cluster
                                ? /* same cluster: best-effort via cluster member check */ true
                                : true,
                            )}
                            trigger={
                              <DropdownMenuItem
                                onSelect={(e) => e.preventDefault()}
                                disabled={v.status === "attached"}
                              >
                                <ArrowLeftRight className="h-3.5 w-3.5 text-ink-3" /> Move…
                              </DropdownMenuItem>
                            }
                          />
                          <SnapshotsDialog
                            teamId={teamId}
                            volume={v}
                            trigger={
                              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                <Camera className="h-3.5 w-3.5 text-ink-3" /> Snapshots…
                              </DropdownMenuItem>
                            }
                          />
                          <DropdownMenuSeparator />
                          <ConfirmDialog
                            destructive
                            title={`Delete ${v.name}?`}
                            confirmPhrase={v.name}
                            description={
                              <>
                                Permanently destroys the volume. Any data on it is lost.
                                Type the volume name to confirm.
                              </>
                            }
                            confirmLabel="Delete volume"
                            onConfirm={() =>
                              new Promise<void>((resolve, reject) =>
                                remove.mutate(v.id, {
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
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function UsageMeter({ usedBytes, sizeGb }: { usedBytes: number; sizeGb: number }) {
  const totalBytes = sizeGb * 1024 * 1024 * 1024;
  const pct = totalBytes > 0 ? Math.min(100, (usedBytes / totalBytes) * 100) : 0;
  const tone = pct > 90 ? "alert" : pct > 75 ? "warn" : "online";
  return (
    <div className="min-w-[120px]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-ink-2 num">{formatBytes(usedBytes)}</span>
        <span className="font-mono text-[10px] text-ink-4 num">/ {sizeGb} GiB</span>
      </div>
      <div className="mt-1 h-1 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={cn(
            "h-full transition-all",
            tone === "alert" && "bg-[color:var(--alert)]",
            tone === "warn" && "bg-[color:var(--warn)]",
            tone === "online" && "bg-[color:var(--online)]",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CreateVolumeDialog({
  teamId,
  clusters,
  servers,
  trigger,
}: {
  teamId: string;
  clusters: Cluster[];
  servers: Server[];
  trigger: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clusterId, setClusterId] = useState(clusters[0]?.id ?? "");
  const [serverId, setServerId] = useState(servers[0]?.id ?? "");
  const [name, setName] = useState("");
  const [sizeGb, setSizeGb] = useState("10");
  const [filesystem, setFilesystem] = useState("ext4");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setClusterId(clusters[0]?.id ?? "");
    setServerId(servers[0]?.id ?? "");
    setName("");
    setSizeGb("10");
    setFilesystem("ext4");
    setError(null);
  }

  const create = useMutation({
    mutationFn: () =>
      volumesApi.create(teamId, {
        cluster_id: clusterId,
        server_id: serverId,
        name: name.trim(),
        size_gb: Number(sizeGb) || 0,
        filesystem: filesystem.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["volumes", teamId] });
      setOpen(false);
      reset();
      router.refresh();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not create volume."),
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
          <DialogEyebrow>Storage · create</DialogEyebrow>
          <DialogTitle>Create volume</DialogTitle>
          <DialogDescription>
            Allocates a block volume on the chosen cluster member. Formatted on first
            attach.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="label-mono">Cluster</div>
              <Select value={clusterId} onValueChange={setClusterId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a cluster" />
                </SelectTrigger>
                <SelectContent>
                  {clusters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="inline-flex items-center gap-2">
                        <Box className="h-3 w-3 text-ink-3" />
                        <span className="font-mono text-[12px]">{c.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="label-mono">Server</div>
              <Select value={serverId} onValueChange={setServerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a server" />
                </SelectTrigger>
                <SelectContent>
                  {servers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="inline-flex items-center gap-2">
                        <ServerIcon className="h-3 w-3 text-ink-3" />
                        <span className="font-mono text-[12px]">{s.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Field id="vol-name" label="Name" hint="Used as the volume's stable identifier.">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              placeholder="app-data"
              maxLength={64}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field id="vol-size" label="Size (GiB)">
              <Input
                type="number"
                min={1}
                step={1}
                value={sizeGb}
                onChange={(e) => setSizeGb(e.target.value)}
              />
            </Field>
            <Field id="vol-fs" label="Filesystem" hint="ext4 is recommended for most workloads.">
              <Input
                value={filesystem}
                onChange={(e) => setFilesystem(e.target.value)}
                autoComplete="off"
                placeholder="ext4"
              />
            </Field>
          </div>
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
            disabled={!clusterId || !serverId || !name.trim() || Number(sizeGb) <= 0}
          >
            <Plus className="h-3.5 w-3.5" /> Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttachDialog({
  teamId,
  volume,
  trigger,
}: {
  teamId: string;
  volume: Volume;
  trigger: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [containerName, setContainerName] = useState("");
  const [mountPath, setMountPath] = useState("/data");
  const [error, setError] = useState<string | null>(null);

  const attach = useMutation({
    mutationFn: () =>
      volumesApi.attach(teamId, volume.id, {
        container_name: containerName.trim(),
        mount_path: mountPath.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["volumes", teamId] });
      setOpen(false);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not attach."),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setError(null);
          setContainerName("");
          setMountPath("/data");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>Volume · attach</DialogEyebrow>
          <DialogTitle>Attach {volume.name}</DialogTitle>
          <DialogDescription>
            Mounts the volume into the named container at the given path. The container
            must already be running on the same server.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field id="attach-container" label="Container">
            <Input
              value={containerName}
              onChange={(e) => setContainerName(e.target.value)}
              autoComplete="off"
              placeholder="my-app"
              maxLength={120}
            />
          </Field>
          <Field id="attach-mount" label="Mount path" hint="Absolute path inside the container.">
            <Input
              value={mountPath}
              onChange={(e) => setMountPath(e.target.value)}
              autoComplete="off"
              placeholder="/data"
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
            onClick={() => attach.mutate()}
            loading={attach.isPending}
            disabled={!containerName.trim() || !mountPath.trim()}
          >
            <LinkIcon className="h-3.5 w-3.5" /> Attach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResizeDialog({
  teamId,
  volume,
  trigger,
}: {
  teamId: string;
  volume: Volume;
  trigger: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newSize, setNewSize] = useState(String(volume.size_gb));
  const [error, setError] = useState<string | null>(null);

  const resize = useMutation({
    mutationFn: () => volumesApi.resize(teamId, volume.id, Number(newSize) || 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["volumes", teamId] });
      setOpen(false);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not resize."),
  });

  const target = Number(newSize) || 0;
  const shrinking = target < volume.size_gb;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setError(null);
          setNewSize(String(volume.size_gb));
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>Volume · resize</DialogEyebrow>
          <DialogTitle>Resize {volume.name}</DialogTitle>
          <DialogDescription>
            Adjust the volume&rsquo;s allocated size. Growing is always safe — shrinking
            may fail or destroy data depending on the filesystem.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {shrinking && (
            <Alert tone="warn">
              <span className="inline-flex items-center gap-2">
                <TriangleAlert className="h-3.5 w-3.5" />
                Shrinking from {volume.size_gb} GiB to {target} GiB can destroy data on
                most filesystems. Take a snapshot first.
              </span>
            </Alert>
          )}
          <Field id="resize-size" label="New size (GiB)" hint={`Currently ${volume.size_gb} GiB.`}>
            <Input
              type="number"
              min={1}
              step={1}
              value={newSize}
              onChange={(e) => setNewSize(e.target.value)}
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
            onClick={() => resize.mutate()}
            loading={resize.isPending}
            disabled={target <= 0 || target === volume.size_gb}
          >
            <Maximize2 className="h-3.5 w-3.5" /> Resize
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  teamId,
  volume,
  servers,
  trigger,
}: {
  teamId: string;
  volume: Volume;
  servers: Server[];
  trigger: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(servers[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const move = useMutation({
    mutationFn: () => volumesApi.move(teamId, volume.id, target),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["volumes", teamId] });
      setOpen(false);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not move."),
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
          <DialogEyebrow>Volume · move</DialogEyebrow>
          <DialogTitle>Move {volume.name}</DialogTitle>
          <DialogDescription>
            Migrates the volume to another server in the same cluster. The volume must be
            detached before moving.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="space-y-2">
            <div className="label-mono">Target server</div>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a server" />
              </SelectTrigger>
              <SelectContent>
                {servers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="inline-flex items-center gap-2">
                      <ServerIcon className="h-3 w-3 text-ink-3" />
                      <span className="font-mono text-[12px]">{s.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => move.mutate()}
            loading={move.isPending}
            disabled={!target || target === volume.server_id}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" /> Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SnapshotsDialog({
  teamId,
  volume,
  trigger,
}: {
  teamId: string;
  volume: Volume;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const snapshots = useQuery({
    queryKey: ["volume-snapshots", volume.id],
    queryFn: () => volumesApi.listSnapshots(teamId, volume.id),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });
  const create = useMutation({
    mutationFn: () => volumesApi.snapshot(teamId, volume.id),
    onSuccess: () => snapshots.refetch(),
  });

  const list = snapshots.data ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogEyebrow>Volume · snapshots</DialogEyebrow>
          <DialogTitle>{volume.name} snapshots</DialogTitle>
          <DialogDescription>
            Snapshots are stored in object storage and can be used to seed a fresh volume
            later via the CLI.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {list.length === 0 ? (
            <EmptyState
              icon={<Camera className="h-4 w-4" />}
              title="No snapshots yet"
              body="Take a snapshot to capture the current state of this volume."
            />
          ) : (
            <ul className="rounded-[var(--radius-md)] border border-line-1 divide-y divide-line-1 bg-surface-1 overflow-hidden">
              {list.map((s: VolumeSnapshot) => (
                <li key={s.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] text-ink-1 truncate">
                      {s.id.slice(0, 12)}…
                    </div>
                    <div className="font-mono text-[10px] text-ink-4 truncate">
                      {s.storage_type} · {s.storage_path || "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[12px] text-ink-1 num">
                      {formatBytes(s.size_bytes)}
                    </div>
                    <div className="font-mono text-[10px] text-ink-4 num">
                      {formatWhen(s.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Close
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => create.mutate()}
            loading={create.isPending}
          >
            <Camera className="h-3.5 w-3.5" /> Take snapshot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function volumeTone(status: string): "online" | "warn" | "alert" | "neutral" | "signal" {
  switch (status) {
    case "attached":     return "online";
    case "unattached":   return "warn";
    case "attaching":
    case "detaching":
    case "moving":
    case "resizing":
    case "snapshotting": return "signal";
    case "error":        return "alert";
    default:             return "neutral";
  }
}

function formatBytes(n: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
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

