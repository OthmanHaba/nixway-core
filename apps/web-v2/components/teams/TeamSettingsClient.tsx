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
import { teamsApi, ApiError } from "@/lib/api";
import type { Team } from "@/lib/types";

export function TeamSettingsClient({ team }: { team: Team }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(team.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: (n: string) => teamsApi.update(team.id, n),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      router.refresh();
    },
    onError: (err) => {
      setRenameError(err instanceof ApiError ? err.message : "Could not rename the team.");
    },
  });

  const remove = useMutation({
    mutationFn: () => teamsApi.remove(team.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      router.replace("/teams");
      router.refresh();
    },
    onError: (err) => {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete the team.");
    },
  });

  function handleRename(e: FormEvent) {
    e.preventDefault();
    setRenameError(null);
    const trimmed = name.trim();
    if (!trimmed) return setRenameError("Team name is required.");
    if (trimmed === team.name) return;
    rename.mutate(trimmed);
  }

  return (
    <div className="space-y-6 max-w-[720px]">
      {/* rename ───────────────────────────────────────────────────── */}
      <Card>
        <form onSubmit={handleRename}>
          <CardHeader>
            <div className="label-mono mb-1">Identity</div>
            <h2 className="text-[18px] text-ink-1">Team name</h2>
            <p className="mt-1 text-[13px] text-ink-3 max-w-md">
              The slug <span className="font-mono text-ink-2">{team.slug}</span> stays the same —
              it&rsquo;s baked into URLs, audit records, and resource references.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            {renameError && <Alert tone="error">{renameError}</Alert>}
            {rename.isSuccess && !renameError && !rename.isPending && (
              <Alert tone="success">Name updated.</Alert>
            )}
            <Field id="team-name" label="Name">
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
              {name.trim() === team.name ? "no changes" : "unsaved"}
            </span>
            <Button
              type="submit"
              loading={rename.isPending}
              disabled={!name.trim() || name.trim() === team.name}
            >
              Save name
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* danger zone ──────────────────────────────────────────────── */}
      <Card className="border-alert/40">
        <CardHeader>
          <div className="label-mono mb-1 text-alert">Danger zone</div>
          <h2 className="text-[18px] text-ink-1">Delete this team</h2>
          <p className="mt-1 text-[13px] text-ink-3 max-w-md">
            Removing a team cascades to all of its servers, clusters, projects, apps, databases,
            secrets, and audit logs. There&rsquo;s no undo.
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
            title="Delete this team?"
            description={
              <>
                Everything owned by <span className="text-ink-1">{team.name}</span> will be deleted —
                servers, projects, databases, volumes, secrets, members, audit logs. This action cannot be undone.
              </>
            }
            confirmPhrase={team.slug}
            confirmLabel="Delete team forever"
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
                <Trash2 className="h-3.5 w-3.5" /> Delete team
              </Button>
            }
          />
        </CardFooter>
      </Card>
    </div>
  );
}
