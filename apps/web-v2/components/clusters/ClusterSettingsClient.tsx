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
import { clustersApi, ApiError } from "@/lib/api";
import type { Cluster } from "@/lib/types";

export function ClusterSettingsClient({
  teamId,
  cluster,
}: {
  teamId: string;
  cluster: Cluster;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(cluster.name);
  const [description, setDescription] = useState(cluster.description);
  const [region, setRegion] = useState(cluster.region);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const dirty =
    name.trim() !== cluster.name ||
    description.trim() !== cluster.description ||
    region.trim() !== cluster.region;

  const save = useMutation({
    mutationFn: () =>
      clustersApi.update(teamId, cluster.id, {
        name: name.trim(),
        description: description.trim(),
        region: region.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clusters", teamId] });
      router.refresh();
    },
    onError: (err) => {
      setRenameError(err instanceof ApiError ? err.message : "Could not update the cluster.");
    },
  });

  const remove = useMutation({
    mutationFn: () => clustersApi.remove(teamId, cluster.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clusters", teamId] });
      router.replace("/clusters");
      router.refresh();
    },
    onError: (err) => {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete the cluster.");
    },
  });

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setRenameError(null);
    if (!name.trim()) return setRenameError("Cluster name is required.");
    if (!dirty) return;
    save.mutate();
  }

  return (
    <div className="space-y-6 max-w-[720px]">
      {/* identity */}
      <Card>
        <form onSubmit={handleSave}>
          <CardHeader>
            <div className="label-mono mb-1">Identity</div>
            <h2 className="text-[18px] text-ink-1">Cluster details</h2>
            <p className="mt-1 text-[13px] text-ink-3 max-w-md">
              The slug <span className="font-mono text-ink-2">{cluster.slug}</span> and CIDR
              <span className="font-mono text-ink-2"> {cluster.cidr}</span> are fixed for the
              cluster&rsquo;s lifetime — they&rsquo;re baked into DNS records and peer configs.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            {renameError && <Alert tone="error">{renameError}</Alert>}
            {save.isSuccess && !renameError && !save.isPending && (
              <Alert tone="success">Cluster updated.</Alert>
            )}
            <Field id="cluster-name" label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                autoComplete="off"
              />
            </Field>
            <Field id="cluster-desc" label="Description">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                autoComplete="off"
                placeholder="Optional"
              />
            </Field>
            <Field id="cluster-region" label="Region">
              <Input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                maxLength={32}
                autoComplete="off"
                placeholder="us-east"
              />
            </Field>
          </CardBody>
          <CardFooter>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
              {dirty ? "unsaved" : "no changes"}
            </span>
            <Button type="submit" loading={save.isPending} disabled={!dirty || !name.trim()}>
              Save changes
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* danger zone */}
      <Card className="border-alert/40">
        <CardHeader>
          <div className="label-mono mb-1 text-alert">Danger zone</div>
          <h2 className="text-[18px] text-ink-1">Delete this cluster</h2>
          <p className="mt-1 text-[13px] text-ink-3 max-w-md">
            Removing the cluster tears down every WireGuard peer, releases the CIDR allocation,
            and unbinds members. Workloads currently scheduled to this cluster will fail to start
            until rebound.
          </p>
        </CardHeader>
        <CardBody>
          {deleteError && <Alert tone="error">{deleteError}</Alert>}
        </CardBody>
        <CardFooter>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
            Type the slug to confirm
          </span>
          <ConfirmDialog
            destructive
            title="Delete this cluster?"
            description={
              <>
                Tearing down <span className="text-ink-1">{cluster.name}</span> removes its mesh,
                DNS zone, and member bindings. This cannot be undone.
              </>
            }
            confirmPhrase={cluster.slug}
            confirmLabel="Delete cluster"
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
                <Trash2 className="h-3.5 w-3.5" /> Delete cluster
              </Button>
            }
          />
        </CardFooter>
      </Card>
    </div>
  );
}
