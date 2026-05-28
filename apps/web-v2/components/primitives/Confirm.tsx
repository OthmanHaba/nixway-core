"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
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
} from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";
import { Field } from "./Field";

interface ConfirmDialogProps {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  /** When supplied, the operator must type this string verbatim to enable confirm. */
  confirmPhrase?: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  /** Async — dialog stays open until the promise settles. */
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmPhrase,
  confirmLabel = "Confirm",
  destructive = false,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const requiresType = !!confirmPhrase;
  const ready = !requiresType || typed.trim() === confirmPhrase;
  const isPending = pending || loading;

  async function handleConfirm() {
    if (!ready || isPending) return;
    try {
      setPending(true);
      await onConfirm();
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>
            <span className="inline-flex items-center gap-2">
              {destructive && <AlertTriangle className="h-3 w-3 text-alert" />}
              {destructive ? "Destructive · confirm" : "Confirm"}
            </span>
          </DialogEyebrow>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {requiresType && (
          <DialogBody>
            <Field
              id="confirm-phrase"
              label="Type to confirm"
              hint={
                <>
                  Enter <span className="font-mono text-ink-2">{confirmPhrase}</span> to enable the action.
                </>
              }
            >
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                autoComplete="off"
              />
            </Field>
          </DialogBody>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={isPending}>Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            variant={destructive ? "destructive" : "primary"}
            loading={isPending}
            disabled={!ready}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
