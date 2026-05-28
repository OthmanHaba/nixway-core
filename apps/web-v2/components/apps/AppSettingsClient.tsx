"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, CardFooter } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Alert } from "@/components/primitives/Alert";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { appsApi, ApiError } from "@/lib/api";
import type { App } from "@/lib/types";

export function AppSettingsClient({ app }: { app: App }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

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
