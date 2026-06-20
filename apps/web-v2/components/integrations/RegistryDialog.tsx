"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Field } from "@/components/primitives/Field";
import { Input } from "@/components/primitives/Input";
import { Button } from "@/components/primitives/Button";
import { Alert } from "@/components/primitives/Alert";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/primitives/Select";
import { registriesApi, ApiError, type CreateRegistryInput } from "@/lib/api";
import type { RegistryCredential } from "@/lib/types";

type RegistryType = "dockerhub" | "ghcr" | "ecr" | "generic";

const TYPE_LABELS: Record<RegistryType, string> = {
  dockerhub: "Docker Hub",
  ghcr: "GitHub Container Registry",
  ecr: "Amazon ECR",
  generic: "Generic (custom URL)",
};

interface Props {
  teamId: string;
  trigger: ReactNode;
  /** When set, the dialog edits this credential instead of creating one. */
  existing?: RegistryCredential;
}

/**
 * Add or edit a container-registry credential. The credential is validated
 * against the live registry server-side before it is stored — a bad token is
 * rejected with the failure reason, so saving here doubles as a connectivity
 * check.
 */
export function RegistryDialog({ teamId, trigger, existing }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const [type, setType] = useState<RegistryType>(
    (existing?.registry_type as RegistryType) ?? "dockerhub",
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [registryUrl, setRegistryUrl] = useState(existing?.registry_url ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState(existing?.region ?? "");
  const [awsKeyId, setAwsKeyId] = useState("");
  const [awsSecret, setAwsSecret] = useState("");

  const isEcr = type === "ecr";
  const isGeneric = type === "generic";

  const save = useMutation({
    mutationFn: () => {
      const input: CreateRegistryInput = {
        name: name.trim(),
        registry_type: type,
        username: username.trim(),
        password,
        registry_url: registryUrl.trim() || undefined,
        region: isEcr ? region.trim() || null : null,
        aws_access_key_id: isEcr ? awsKeyId.trim() || null : null,
        aws_secret_access_key: isEcr ? awsSecret : undefined,
      };
      return existing
        ? registriesApi.update(teamId, existing.id, input)
        : registriesApi.create(teamId, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["registries", teamId] });
      setOpen(false);
    },
  });

  const errMsg =
    save.error instanceof ApiError
      ? save.error.message
      : save.error
        ? "Could not save the registry."
        : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>Integrations · registry</DialogEyebrow>
          <DialogTitle>{existing ? "Edit registry" : "Add a container registry"}</DialogTitle>
          <DialogDescription>
            Credentials are validated against the registry before they&rsquo;re saved, then
            encrypted at rest. They&rsquo;re used to pull private images at build and deploy time.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {errMsg && <Alert tone="error">{errMsg}</Alert>}

          <Field id="reg-name" label="Name" hint="A label to recognise this credential.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-dockerhub" autoComplete="off" />
          </Field>

          <div className="space-y-1.5">
            <div className="label-mono">Registry type</div>
            <Select value={type} onValueChange={(v) => setType(v as RegistryType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABELS) as RegistryType[]).map((t) => (
                  <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isGeneric && (
            <Field id="reg-url" label="Registry URL" hint="e.g. https://registry.example.com">
              <Input value={registryUrl} onChange={(e) => setRegistryUrl(e.target.value)} placeholder="https://registry.example.com" autoComplete="off" />
            </Field>
          )}

          {isEcr ? (
            <>
              <Field id="reg-region" label="AWS region" hint="e.g. eu-central-1">
                <Input value={region ?? ""} onChange={(e) => setRegion(e.target.value)} placeholder="eu-central-1" autoComplete="off" />
              </Field>
              <Field id="reg-aws-key" label="AWS access key ID">
                <Input value={awsKeyId} onChange={(e) => setAwsKeyId(e.target.value)} autoComplete="off" />
              </Field>
              <Field id="reg-aws-secret" label="AWS secret access key">
                <Input type="password" value={awsSecret} onChange={(e) => setAwsSecret(e.target.value)} autoComplete="off" />
              </Field>
            </>
          ) : (
            <>
              <Field id="reg-user" label="Username">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              </Field>
              <Field
                id="reg-pass"
                label={existing ? "Password / token (re-enter to change)" : "Password / token"}
              >
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              </Field>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={save.isPending}>Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            variant="primary"
            loading={save.isPending}
            disabled={!name.trim()}
            onClick={() => save.mutate()}
          >
            {existing ? "Save changes" : "Validate & add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
