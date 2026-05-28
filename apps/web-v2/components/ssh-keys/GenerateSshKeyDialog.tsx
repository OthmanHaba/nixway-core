"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound } from "lucide-react";
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
import { sshKeysApi, ApiError } from "@/lib/api";
import type { SshKey, SshKeyType } from "@/lib/types";
import { cn } from "@/lib/cn";

const TYPES: { value: SshKeyType; label: string; hint: string }[] = [
  { value: "ed25519", label: "ed25519", hint: "Modern, fast, recommended for most fleets." },
  { value: "rsa",     label: "rsa",     hint: "Wider compatibility with legacy infrastructure." },
];

export function GenerateSshKeyDialog({
  teamId,
  trigger,
}: {
  teamId: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [keyType, setKeyType] = useState<SshKeyType>("ed25519");
  const [issued, setIssued] = useState<SshKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  function reset() {
    setName("");
    setKeyType("ed25519");
    setIssued(null);
    setError(null);
  }

  const generate = useMutation({
    mutationFn: () => sshKeysApi.create(teamId, { name: name.trim(), key_type: keyType }),
    onSuccess: (key) => {
      queryClient.invalidateQueries({ queryKey: ["ssh-keys", teamId] });
      setIssued(key);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not generate the key.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Key name is required.");
    generate.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="w-[min(620px,calc(100vw-2rem))]">
        {issued ? (
          <RevealPane sshKey={issued} onClose={() => setOpen(false)} />
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <DialogHeader>
              <DialogEyebrow>Access · ssh key</DialogEyebrow>
              <DialogTitle>Generate an SSH key</DialogTitle>
              <DialogDescription>
                We generate the keypair on the platform. The private key is encrypted at rest
                and shown to you exactly once — copy it now, then move it into your secrets store.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-5">
              {error && <Alert tone="error">{error}</Alert>}
              <Field
                id="key-name"
                label="Key name"
                hint="Used to identify the key when registering servers."
              >
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  autoComplete="off"
                  placeholder="atlas-control"
                />
              </Field>
              <div className="space-y-2">
                <div className="label-mono">Algorithm</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TYPES.map((t) => {
                    const selected = keyType === t.value;
                    return (
                      <button
                        type="button"
                        key={t.value}
                        onClick={() => setKeyType(t.value)}
                        className={cn(
                          "text-left rounded-[var(--radius-sm)] border p-3 transition-colors",
                          selected
                            ? "border-signal bg-[color:var(--signal-soft)]/30"
                            : "border-line-1 hover:bg-surface-2",
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-[12px] text-ink-1">{t.label}</span>
                          {selected && <span className="h-1.5 w-1.5 rounded-full bg-signal" />}
                        </div>
                        <div className="text-[11px] text-ink-3">{t.hint}</div>
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
              <Button type="submit" loading={generate.isPending}>
                Generate keypair
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevealPane({ sshKey, onClose }: { sshKey: SshKey; onClose: () => void }) {
  const hasPrivate = !!sshKey.private_key;

  return (
    <>
      <DialogHeader>
        <DialogEyebrow>Access · reveal</DialogEyebrow>
        <DialogTitle>Keypair generated</DialogTitle>
        <DialogDescription>
          {hasPrivate
            ? "Copy the private key now — we won't show it again. The public key is always available."
            : "The key is created. Use the public key below; the private key is encrypted on the platform and is required for server onboarding only."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <KeyBlock label="Public key" value={sshKey.public_key} />
        {hasPrivate && (
          <KeyBlock label="Private key" value={sshKey.private_key!} monoTone="alert" />
        )}
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <Row label="Name"><span className="font-mono text-ink-1">{sshKey.name}</span></Row>
          <Row label="Type">
            <span className="inline-block font-mono uppercase tracking-[0.14em] text-[10px] text-ink-2 border border-line-1 rounded-[3px] px-1.5 py-0.5">
              {sshKey.key_type}
            </span>
          </Row>
          <Row label="Fingerprint" wide>
            <span className="font-mono text-[11px] text-ink-2 break-all">{sshKey.fingerprint}</span>
          </Row>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" onClick={onClose}>
          <KeyRound className="h-3.5 w-3.5" /> Done
        </Button>
      </DialogFooter>
    </>
  );
}

function Row({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 space-y-1" : "space-y-1"}>
      <div className="label-mono">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function KeyBlock({
  label,
  value,
  monoTone,
}: {
  label: string;
  value: string;
  monoTone?: "alert";
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="label-mono">{label}</div>
        <button
          type="button"
          onClick={copy}
          className={cn(
            "inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-sm)] border transition-colors",
            copied
              ? "border-online text-online"
              : "border-line-1 text-ink-2 hover:bg-surface-2 hover:text-ink-1",
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
      </div>
      <pre
        className={cn(
          "rounded-[var(--radius-sm)] bg-surface-2 border border-line-1 px-3 py-2.5",
          "font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap",
          monoTone === "alert" ? "text-alert/90" : "text-ink-1",
          "max-h-[180px] overflow-y-auto",
        )}
      >
        {value}
      </pre>
    </div>
  );
}
