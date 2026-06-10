"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, CardFooter } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/primitives/Select";
import { serversApi, ApiError } from "@/lib/api";
import { SERVER_ROLES, type Server, type ServerRole } from "@/lib/types";

export function ServerSettingsClient({
  teamId,
  server,
}: {
  teamId: string;
  server: Server;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(server.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [role, setRole] = useState<ServerRole>(server.role);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [hostname, setHostname] = useState(server.hostname ?? "");
  const [publicIp, setPublicIp] = useState(server.public_ip ?? "");
  const [connError, setConnError] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: (n: string) => serversApi.update(teamId, server.id, { name: n }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers", teamId] });
      router.refresh();
    },
    onError: (err) => {
      setRenameError(err instanceof ApiError ? err.message : "Could not rename the server.");
    },
  });

  const updateRole = useMutation({
    mutationFn: (next: ServerRole) => serversApi.setRole(teamId, server.id, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers", teamId] });
      router.refresh();
    },
    onError: (err) => {
      setRoleError(err instanceof ApiError ? err.message : "Could not update the role.");
    },
  });

  const updateConn = useMutation({
    mutationFn: (input: { hostname?: string; public_ip?: string }) =>
      serversApi.update(teamId, server.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers", teamId] });
      router.refresh();
    },
    onError: (err) => {
      setConnError(err instanceof ApiError ? err.message : "Could not update connection details.");
    },
  });

  const remove = useMutation({
    mutationFn: () => serversApi.remove(teamId, server.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers", teamId] });
      router.replace("/servers");
      router.refresh();
    },
    onError: (err) => {
      setDeleteError(err instanceof ApiError ? err.message : "Could not decommission the server.");
    },
  });

  function handleRename(e: FormEvent) {
    e.preventDefault();
    setRenameError(null);
    const trimmed = name.trim();
    if (!trimmed) return setRenameError("Server name is required.");
    if (trimmed === server.name) return;
    rename.mutate(trimmed);
  }

  function handleConnSave(e: FormEvent) {
    e.preventDefault();
    setConnError(null);
    const h = hostname.trim();
    const ip = publicIp.trim();
    if (!h) return setConnError("Hostname is required.");
    if (!ip) return setConnError("Public IP is required.");
    // Lenient IPv4 / IPv6 shape check — server validates strictly
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6 = /^[0-9a-fA-F:]+$/;
    if (!ipv4.test(ip) && !ipv6.test(ip)) return setConnError("Enter a valid IPv4 or IPv6 address.");
    const input: { hostname?: string; public_ip?: string } = {};
    if (h  !== server.hostname)  input.hostname  = h;
    if (ip !== server.public_ip) input.public_ip = ip;
    if (Object.keys(input).length === 0) return;
    updateConn.mutate(input);
  }

  const connUnchanged =
    hostname.trim() === (server.hostname ?? "") &&
    publicIp.trim() === (server.public_ip ?? "");

  return (
    <div className="space-y-6 max-w-[720px]">
      {/* rename ───────────────────────────────────────────────── */}
      <Card>
        <form onSubmit={handleRename}>
          <CardHeader>
            <div className="label-mono mb-1">Identity</div>
            <h2 className="text-[18px] text-ink-1">Server name</h2>
            <p className="mt-1 text-[13px] text-ink-3 max-w-md">
              Only the display name is editable here. To update the hostname or public IP — for
              example when the server&rsquo;s address changed — use the Connection card below.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            {renameError && <Alert tone="error">{renameError}</Alert>}
            {rename.isSuccess && !renameError && !rename.isPending && (
              <Alert tone="success">Name updated.</Alert>
            )}
            <Field id="server-name" label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                autoComplete="off"
              />
            </Field>
          </CardBody>
          <CardFooter>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
              {name.trim() === server.name ? "no changes" : "unsaved"}
            </span>
            <Button
              type="submit"
              loading={rename.isPending}
              disabled={!name.trim() || name.trim() === server.name}
            >
              Save name
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* connection ───────────────────────────────────────────── */}
      <Card>
        <form onSubmit={handleConnSave}>
          <CardHeader>
            <div className="label-mono mb-1">Connection</div>
            <h2 className="text-[18px] text-ink-1">Address &amp; hostname</h2>
            <p className="mt-1 text-[13px] text-ink-3 max-w-md">
              If this server has no static IP and its address changed, update it here. Provisioning,
              the web terminal, and the cluster mesh will use the new address. If the server is in a
              cluster its mesh endpoint is updated automatically.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            {connError && <Alert tone="error">{connError}</Alert>}
            {updateConn.isSuccess && !connError && !updateConn.isPending && (
              <Alert tone="success">Connection details updated.</Alert>
            )}
            <Field id="server-hostname" label="Hostname">
              <Input
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                className="font-mono"
                autoComplete="off"
              />
            </Field>
            <Field id="server-public-ip" label="Public IP">
              <Input
                value={publicIp}
                onChange={(e) => setPublicIp(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </CardBody>
          <CardFooter>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
              {connUnchanged ? "no changes" : "unsaved"}
            </span>
            <Button
              type="submit"
              loading={updateConn.isPending}
              disabled={connUnchanged}
            >
              Save connection
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* role ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1">Cluster role</div>
          <h2 className="text-[18px] text-ink-1">What this server does</h2>
          <p className="mt-1 text-[13px] text-ink-3 max-w-md">
            Workers run app & database containers. Edge nodes front the cluster with Traefik and
            route public traffic to workers over the mesh. <span className="text-ink-2">Both</span>{" "}
            is the right pick for single-node clusters.
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          {roleError && <Alert tone="error">{roleError}</Alert>}
          {updateRole.isSuccess && !roleError && !updateRole.isPending && (
            <Alert tone="success">Role updated.</Alert>
          )}
          <Field id="server-role" label="Role">
            <Select value={role} onValueChange={(v) => setRole(v as ServerRole)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVER_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-ink-1">{r.label}</span>
                      <span className="text-[11px] text-ink-3">{r.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </CardBody>
        <CardFooter>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
            {role === server.role ? "no changes" : "unsaved"}
          </span>
          <Button
            type="button"
            loading={updateRole.isPending}
            disabled={role === server.role}
            onClick={() => {
              setRoleError(null);
              updateRole.mutate(role);
            }}
          >
            Save role
          </Button>
        </CardFooter>
      </Card>

      {/* danger zone ──────────────────────────────────────────── */}
      <Card className="border-alert/40">
        <CardHeader>
          <div className="label-mono mb-1 text-alert">Danger zone</div>
          <h2 className="text-[18px] text-ink-1">Decommission this server</h2>
          <p className="mt-1 text-[13px] text-ink-3 max-w-md">
            Removes the server from the fleet, evicts running deployments, and tears down its agent
            tunnel. The host stays online — only the platform&rsquo;s record of it is destroyed.
          </p>
        </CardHeader>
        <CardBody>
          {deleteError && <Alert tone="error">{deleteError}</Alert>}
        </CardBody>
        <CardFooter>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
            Type the hostname to confirm
          </span>
          <ConfirmDialog
            destructive
            title="Decommission this server?"
            description={
              <>
                <span className="text-ink-1">{server.name}</span> (
                <span className="font-mono">{server.hostname}</span>) will be removed from the fleet.
                Running deployments are evicted. This action cannot be undone.
              </>
            }
            confirmPhrase={server.hostname}
            confirmLabel="Decommission"
            onConfirm={() =>
              new Promise<void>((resolve, reject) =>
                remove.mutate(undefined, {
                  onSuccess: () => resolve(),
                  onError: (e) => reject(e),
                }),
              )
            }
            trigger={
              <Button variant="destructive">
                <Trash2 className="h-3.5 w-3.5" /> Decommission
              </Button>
            }
          />
        </CardFooter>
      </Card>
    </div>
  );
}
