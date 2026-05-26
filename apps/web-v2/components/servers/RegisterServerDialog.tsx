"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, KeyRound } from "lucide-react";
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
import { serversApi, ApiError } from "@/lib/api";
import type { SshKey } from "@/lib/types";

export function RegisterServerDialog({
  teamId,
  sshKeys,
  trigger,
}: {
  teamId: string;
  sshKeys: SshKey[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [publicIp, setPublicIp] = useState("");
  const [sshUser, setSshUser] = useState("root");
  const [sshPort, setSshPort] = useState("22");
  const [sshKeyId, setSshKeyId] = useState<string>(sshKeys[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  function reset() {
    setName("");
    setHostname("");
    setPublicIp("");
    setSshUser("root");
    setSshPort("22");
    setSshKeyId(sshKeys[0]?.id ?? "");
    setError(null);
  }

  const create = useMutation({
    mutationFn: () =>
      serversApi.create(teamId, {
        name: name.trim(),
        hostname: hostname.trim(),
        public_ip: publicIp.trim(),
        ssh_user: sshUser.trim() || undefined,
        ssh_port: Number(sshPort) || 22,
        ssh_key_id: sshKeyId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers", teamId] });
      setOpen(false);
      reset();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not register the server.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !hostname.trim() || !publicIp.trim()) {
      return setError("Name, hostname, and public IP are required.");
    }
    if (!sshKeyId) {
      return setError("Pick an SSH key.");
    }
    create.mutate();
  }

  const hasKeys = sshKeys.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="w-[min(620px,calc(100vw-2rem))]">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogEyebrow>Infrastructure · register</DialogEyebrow>
            <DialogTitle>Add a server</DialogTitle>
            <DialogDescription>
              Connect a bare-metal or cloud host to the fleet. The agent installs over SSH and
              calls home over an outbound tunnel — no inbound ports required.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {error && <Alert tone="error">{error}</Alert>}
            {!hasKeys && (
              <Alert tone="warn" title="No SSH key">
                You need at least one SSH key to onboard a server.{" "}
                <Link href="/ssh-keys" className="text-signal hover:underline underline-offset-4">
                  Generate one
                </Link>
                {" "}— then come back.
              </Alert>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field id="srv-name" label="Server name" className="sm:col-span-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  autoComplete="off"
                  placeholder="atlas-edge-01"
                />
              </Field>
              <Field id="srv-hostname" label="Hostname / domain">
                <Input
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  required
                  autoComplete="off"
                  placeholder="atlas-edge-01.example.com"
                />
              </Field>
              <Field id="srv-ip" label="Public IP">
                <Input
                  value={publicIp}
                  onChange={(e) => setPublicIp(e.target.value)}
                  required
                  autoComplete="off"
                  placeholder="203.0.113.42"
                />
              </Field>
              <Field id="srv-user" label="SSH user" hint="Default: root.">
                <Input
                  value={sshUser}
                  onChange={(e) => setSshUser(e.target.value)}
                  autoComplete="off"
                  placeholder="root"
                />
              </Field>
              <Field id="srv-port" label="SSH port" hint="Default: 22.">
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={sshPort}
                  onChange={(e) => setSshPort(e.target.value)}
                  autoComplete="off"
                  placeholder="22"
                />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="label-mono">SSH key</div>
              <Select value={sshKeyId} onValueChange={setSshKeyId} disabled={!hasKeys}>
                <SelectTrigger>
                  <SelectValue placeholder={hasKeys ? "Pick a key" : "No keys available"} />
                </SelectTrigger>
                <SelectContent>
                  {sshKeys.map((key) => (
                    <SelectItem key={key.id} value={key.id}>
                      <span className="inline-flex items-center gap-2">
                        <KeyRound className="h-3 w-3 text-ink-3" />
                        <span>{key.name}</span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 ml-1">
                          {key.key_type}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[12px] text-ink-3">
                The platform uses this key for the initial agent install. Rotate or revoke it from{" "}
                <Link href="/ssh-keys" className="text-signal hover:underline underline-offset-4">SSH Keys</Link>.
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending} disabled={!hasKeys}>
              Register server <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
