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
import { projectsApi, ApiError } from "@/lib/api";
import type { Project } from "@/lib/types";

export function ProjectSettingsClient({
  teamId,
  project,
}: {
  teamId: string;
  project: Project;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const dirty =
    name.trim() !== project.name || description.trim() !== project.description;

  const save = useMutation({
    mutationFn: () =>
      projectsApi.update(teamId, project.id, {
        name: name.trim(),
        description: description.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects", teamId] });
      router.refresh();
    },
    onError: (err) => {
      setSaveError(err instanceof ApiError ? err.message : "Could not update the project.");
    },
  });

  const remove = useMutation({
    mutationFn: () => projectsApi.remove(teamId, project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects", teamId] });
      router.replace("/projects");
      router.refresh();
    },
    onError: (err) => {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete the project.");
    },
  });

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    if (!name.trim()) return setSaveError("Project name is required.");
    if (!dirty) return;
    save.mutate();
  }

  return (
    <div className="space-y-6 max-w-[720px]">
      <Card>
        <form onSubmit={handleSave}>
          <CardHeader>
            <div className="label-mono mb-1">Identity</div>
            <h2 className="text-[18px] text-ink-1">Project details</h2>
            <p className="mt-1 text-[13px] text-ink-3 max-w-md">
              The slug <span className="font-mono text-ink-2">{project.slug}</span> and the
              cluster binding are fixed — they&rsquo;re referenced by apps, secrets, and audit
              records.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            {saveError && <Alert tone="error">{saveError}</Alert>}
            {save.isSuccess && !saveError && !save.isPending && (
              <Alert tone="success">Project updated.</Alert>
            )}
            <Field id="project-name" label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                autoComplete="off"
              />
            </Field>
            <Field id="project-desc" label="Description">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                autoComplete="off"
                placeholder="Optional"
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

      <Card className="border-alert/40">
        <CardHeader>
          <div className="label-mono mb-1 text-alert">Danger zone</div>
          <h2 className="text-[18px] text-ink-1">Delete this project</h2>
          <p className="mt-1 text-[13px] text-ink-3 max-w-md">
            Removes every app, environment, deployment, and scoped secret inside the project.
            Cluster membership is untouched. This action cannot be undone.
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
            title="Delete this project?"
            description={
              <>
                Tearing down <span className="text-ink-1">{project.name}</span> removes its apps,
                environments, deployments, and secrets. This cannot be undone.
              </>
            }
            confirmPhrase={project.slug}
            confirmLabel="Delete project"
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
                <Trash2 className="h-3.5 w-3.5" /> Delete project
              </Button>
            }
          />
        </CardFooter>
      </Card>
    </div>
  );
}
