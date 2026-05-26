"use client";

import { useState, type FormEvent, type ReactNode } from "react";
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
import { invitesApi, ApiError } from "@/lib/api";
import type { Role } from "@/lib/types";

const ROLES: { value: Exclude<Role, "owner">; label: string; hint: string }[] = [
  { value: "admin",  label: "Admin",  hint: "Manage members, servers, deployments" },
  { value: "member", label: "Member", hint: "View resources, create deployments" },
];

export function InviteMemberDialog({
  teamId,
  trigger,
}: {
  teamId: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("member");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const invite = useMutation({
    mutationFn: () => invitesApi.create(teamId, email.trim(), role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-invites", teamId] });
      setEmail("");
      setRole("member");
      setError(null);
      setOpen(false);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not send the invite. Try again.",
      );
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    invite.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) { setError(null); setEmail(""); setRole("member"); }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogEyebrow>Access · invite</DialogEyebrow>
            <DialogTitle>Invite a member</DialogTitle>
            <DialogDescription>
              We&rsquo;ll send an invitation link that expires in seven days. If they don&rsquo;t
              have an account yet, they can sign up from the link.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {error && <Alert tone="error">{error}</Alert>}
            <Field id="invite-email" label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="off"
                placeholder="operator@example.com"
              />
            </Field>
            <div className="space-y-2">
              <div className="label-mono">Role</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ROLES.map((r) => {
                  const selected = role === r.value;
                  return (
                    <button
                      type="button"
                      key={r.value}
                      onClick={() => setRole(r.value)}
                      className={
                        "text-left rounded-[var(--radius-sm)] border p-3 transition-colors " +
                        (selected
                          ? "border-signal bg-[color:var(--signal-soft)]/30"
                          : "border-line-1 hover:bg-surface-2")
                      }
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[13px] text-ink-1 font-medium capitalize">{r.label}</span>
                        {selected && <span className="h-1.5 w-1.5 rounded-full bg-signal" />}
                      </div>
                      <div className="text-[11px] text-ink-3">{r.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={invite.isPending}>
              Send invite <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
