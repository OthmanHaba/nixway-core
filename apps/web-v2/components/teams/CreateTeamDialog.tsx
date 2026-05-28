"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
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
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { teamsApi, ApiError } from "@/lib/api";
import { TEAM_COOKIE } from "@/lib/team-cookie";

export function CreateTeamDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: (n: string) => teamsApi.create(n),
    onSuccess: (team) => {
      // Switch to the new team and refresh server data.
      document.cookie = `${TEAM_COOKIE}=${team.id}; path=/; max-age=31536000; SameSite=Lax`;
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setOpen(false);
      setName("");
      setError(null);
      router.push(`/teams/${team.id}/members`);
      router.refresh();
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not create the team. Try again.",
      );
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Team name is required.");
      return;
    }
    create.mutate(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setError(null); setName(""); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogEyebrow>Console · provisioning</DialogEyebrow>
            <DialogTitle>Create a team</DialogTitle>
            <DialogDescription>
              Teams own servers, projects, secrets, and members. You become the owner —
              invite collaborators afterwards.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {error && <Alert tone="error">{error}</Alert>}
            <Field id="team-name" label="Team name" hint="Slugged automatically (e.g. 'Atlas Labs' → 'atlas-labs').">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Atlas Labs"
                required
                maxLength={64}
                autoFocus
                autoComplete="off"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending}>
              Create team <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
