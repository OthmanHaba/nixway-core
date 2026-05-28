"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff, ShieldAlert } from "lucide-react";
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
import { Alert } from "@/components/primitives/Alert";
import { secretsApi, ApiError } from "@/lib/api";
import type { Secret } from "@/lib/types";
import { cn } from "@/lib/cn";

export function RevealSecretDialog({
  teamId,
  secret,
  trigger,
}: {
  teamId: string;
  secret: Secret;
  trigger: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      // wipe local copy when dialog closes
      setValue(null);
      setVisible(false);
      setError(null);
      setCopied(false);
    }
  }, [open]);

  async function reveal() {
    setError(null);
    setPending(true);
    try {
      const res = await secretsApi.reveal(teamId, secret.id);
      setValue(res.value);
      queryClient.invalidateQueries({ queryKey: ["team-secrets", teamId] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(
          "This secret has already been revealed. Rotate it to set a new value, then a fresh reveal becomes available.",
        );
      } else {
        setError(err instanceof ApiError ? err.message : "Reveal failed.");
      }
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>
            <span className="inline-flex items-center gap-2">
              <ShieldAlert className="h-3 w-3 text-warn" /> Access · reveal
            </span>
          </DialogEyebrow>
          <DialogTitle>{secret.key}</DialogTitle>
          <DialogDescription>
            Secrets are revealed at most once. After this, the value can only be replaced via
            rotation. The reveal is recorded in the audit log with your IP.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {value ? (
            <>
              <div>
                <div className="label-mono mb-1.5 flex items-center justify-between">
                  <span>Plaintext value</span>
                  <button
                    type="button"
                    onClick={() => setVisible((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-ink-3 hover:text-ink-1 transition-colors"
                  >
                    {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
                      {visible ? "Hide" : "Show"}
                    </span>
                  </button>
                </div>
                <div className="flex items-stretch gap-2">
                  <code
                    className={cn(
                      "flex-1 min-w-0 rounded-[var(--radius-sm)] bg-surface-2 border border-line-1 px-3 py-2.5",
                      "font-mono text-[12px] text-ink-1 break-all",
                      visible ? "" : "select-none",
                    )}
                  >
                    {visible ? value : "•".repeat(Math.min(value.length, 40))}
                  </code>
                  <button
                    type="button"
                    onClick={copy}
                    className={cn(
                      "shrink-0 px-3 inline-flex items-center gap-2 rounded-[var(--radius-sm)] border transition-colors",
                      copied ? "border-online text-online" : "border-line-1 text-ink-2 hover:bg-surface-2 hover:text-ink-1",
                    )}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
                      {copied ? "Copied" : "Copy"}
                    </span>
                  </button>
                </div>
              </div>
              <Alert tone="warn" title="Treat this as one-shot">
                Copy the value into a secure store now. After this dialog closes the value cannot
                be retrieved again — only rotated.
              </Alert>
            </>
          ) : (
            <Alert tone="info" title="Confirm reveal">
              You&rsquo;re about to disclose the plaintext of{" "}
              <span className="font-mono text-ink-1">{secret.key}</span> from the{" "}
              <span className="font-mono text-ink-1">{secret.environment}</span> environment.
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {value ? "Done" : "Cancel"}
            </Button>
          </DialogClose>
          {!value && (
            <Button type="button" onClick={reveal} loading={pending}>
              <Eye className="h-3.5 w-3.5" /> Reveal value
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
