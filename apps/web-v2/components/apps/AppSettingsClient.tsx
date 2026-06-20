"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, CardFooter } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Alert } from "@/components/primitives/Alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/primitives/Select";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { appsApi, registriesApi, ApiError } from "@/lib/api";
import type { App } from "@/lib/types";

export function AppSettingsClient({ app, teamId }: { app: App; teamId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // ─── Registry credential (required for github-source builds) ───
  const isGithub = app.source_type === "github";
  const [registryId, setRegistryId] = useState<string>(app.registry_credential_id ?? "");
  const [registrySaved, setRegistrySaved] = useState(false);

  const registriesQ = useQuery({
    queryKey: ["registries", teamId],
    queryFn: () => registriesApi.list(teamId!),
    enabled: isGithub && !!teamId,
    staleTime: 60_000,
  });
  const registries = registriesQ.data ?? [];
  const noRegistries = registriesQ.isSuccess && registries.length === 0;

  // Keep the select in sync if the app prop changes (e.g. after a refresh).
  useEffect(() => {
    setRegistryId(app.registry_credential_id ?? "");
  }, [app.registry_credential_id]);

  const saveRegistry = useMutation({
    mutationFn: () => appsApi.setRegistryCredential(app.id, registryId || null),
    onSuccess: () => {
      setRegistrySaved(true);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["app", app.id] });
      router.refresh();
    },
    onError: (err) => {
      setRegistrySaved(false);
      setError(err instanceof ApiError ? err.message : "Could not update the registry credential.");
    },
  });

  const remove = useMutation({
    mutationFn: () => appsApi.remove(app.project_id, app.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-apps", app.project_id] });
      router.replace(`/projects/${app.project_id}/apps`);
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not delete the app.");
    },
  });

  return (
    <div className="space-y-6 max-w-[720px]">
      {isGithub && (
        <Card>
          <CardHeader>
            <div className="label-mono mb-1">Build &amp; registry</div>
            <h2 className="text-[18px] text-ink-1">Container registry</h2>
            <p className="mt-1 text-[13px] text-ink-3 max-w-md">
              GitHub apps build an image on each push and push it to a registry before deploying.
              A registry credential is required — without one, builds fail immediately.
            </p>
          </CardHeader>
          <CardBody className="space-y-3">
            {error && <Alert tone="error">{error}</Alert>}
            {!app.registry_credential_id && !registrySaved && (
              <Alert tone="warn">
                No registry is attached to this app. Pick one below, or builds will fail with
                “app has no registry credential”.
              </Alert>
            )}
            {!teamId ? (
              <Alert tone="info">Couldn’t resolve this app’s team to list registries.</Alert>
            ) : noRegistries ? (
              <Alert tone="warn">
                No container registry connected for this team. Add one in{" "}
                <Link href="/integrations" className="underline underline-offset-2 hover:text-signal">
                  Integrations
                </Link>{" "}
                first.
              </Alert>
            ) : (
              <Select
                value={registryId}
                onValueChange={(v) => {
                  setRegistryId(v);
                  setRegistrySaved(false);
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={registriesQ.isFetching ? "Loading registries…" : "Select a registry"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {registries.map((reg) => (
                    <SelectItem key={reg.id} value={reg.id}>
                      {reg.name} · {reg.registry_type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {registrySaved && <Alert tone="success">Registry credential updated.</Alert>}
          </CardBody>
          <CardFooter>
            <Button
              onClick={() => saveRegistry.mutate()}
              loading={saveRegistry.isPending}
              disabled={!registryId || registryId === (app.registry_credential_id ?? "")}
            >
              Save registry
            </Button>
          </CardFooter>
        </Card>
      )}

      <Card className="border-alert/40">
        <CardHeader>
          <div className="label-mono mb-1 text-alert">Danger zone</div>
          <h2 className="text-[18px] text-ink-1">Delete this app</h2>
          <p className="mt-1 text-[13px] text-ink-3 max-w-md">
            Removes every deployment, build, traffic route, and scaling rule for this app.
            Running containers are stopped and their volumes detached. This cannot be undone.
          </p>
        </CardHeader>
        <CardBody>{error && <Alert tone="error">{error}</Alert>}</CardBody>
        <CardFooter>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
            Type the slug to confirm
          </span>
          <ConfirmDialog
            destructive
            title="Delete this app?"
            description={
              <>
                Tearing down <span className="text-ink-1">{app.name}</span> stops every container,
                removes deployment history, and cancels in-flight builds.
              </>
            }
            confirmPhrase={app.slug}
            confirmLabel="Delete app"
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
                <Trash2 className="h-3.5 w-3.5" /> Delete app
              </Button>
            }
          />
        </CardFooter>
      </Card>
    </div>
  );
}
