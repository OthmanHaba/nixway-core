"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ShieldAlert } from "lucide-react";
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
import { Badge } from "@/components/primitives/Badge";
import { tokensApi, ApiError } from "@/lib/api";
import type { ApiToken } from "@/lib/types";
import { cn } from "@/lib/cn";

type Level = "none" | "read" | "write";
type Resource = "teams" | "members" | "invites" | "tokens" | "audit" | "servers";

const RESOURCES: { key: Resource; label: string; description: string; supportsWrite: boolean }[] = [
  { key: "teams",   label: "Teams",   description: "Read team metadata; rename or delete the team",        supportsWrite: true },
  { key: "members", label: "Members", description: "View the roster; invite, change roles, or remove",     supportsWrite: true },
  { key: "invites", label: "Invites", description: "Inspect pending invitations; create or cancel them",   supportsWrite: true },
  { key: "tokens",  label: "Tokens",  description: "List API tokens; create or revoke them",               supportsWrite: true },
  { key: "audit",   label: "Audit",   description: "Read the immutable activity log",                      supportsWrite: false },
  { key: "servers", label: "Servers", description: "List servers and tags; register or decommission them", supportsWrite: true },
];

const EXPIRY_OPTIONS: { value: string; label: string }[] = [
  { value: "",      label: "Never" },
  { value: "168h",  label: "7 days" },
  { value: "720h",  label: "30 days" },
  { value: "2160h", label: "90 days" },
  { value: "8760h", label: "1 year" },
];

function levelsToScopes(superAdmin: boolean, levels: Record<Resource, Level>): string[] {
  if (superAdmin) return ["*"];
  const scopes: string[] = [];
  for (const r of RESOURCES) {
    const lv = levels[r.key];
    if (lv === "read")  scopes.push(`${r.key}:read`);
    if (lv === "write") scopes.push(`${r.key}:*`);
  }
  return scopes;
}

const ZERO_LEVELS: Record<Resource, Level> = {
  teams: "none", members: "none", invites: "none",
  tokens: "none", audit: "none", servers: "none",
};

export function CreateTokenDialog({
  teamId,
  trigger,
}: {
  teamId: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiresIn, setExpiresIn] = useState<string>("720h");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [levels, setLevels] = useState<Record<Resource, Level>>(ZERO_LEVELS);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<ApiToken | null>(null);
  const queryClient = useQueryClient();

  function reset() {
    setName("");
    setExpiresIn("720h");
    setSuperAdmin(false);
    setLevels(ZERO_LEVELS);
    setError(null);
    setIssued(null);
  }

  const create = useMutation({
    mutationFn: () =>
      tokensApi.create(teamId, {
        name: name.trim(),
        scopes: levelsToScopes(superAdmin, levels),
        expires_in: expiresIn || undefined,
      }),
    onSuccess: (token) => {
      queryClient.invalidateQueries({ queryKey: ["team-tokens", teamId] });
      setIssued(token);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not create token.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim())  return setError("Token name is required.");
    const scopes = levelsToScopes(superAdmin, levels);
    if (scopes.length === 0) return setError("Choose at least one scope, or enable Full admin.");
    create.mutate();
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
      <DialogContent className="w-[min(680px,calc(100vw-2rem))]">
        {issued ? (
          <RevealPane token={issued} onClose={() => setOpen(false)} />
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <DialogHeader>
              <DialogEyebrow>Access · token</DialogEyebrow>
              <DialogTitle>Create an API token</DialogTitle>
              <DialogDescription>
                Tokens authenticate machine clients. Pick the smallest scope set that does the job —
                you can always issue a new one with broader access later.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-5">
              {error && <Alert tone="error">{error}</Alert>}
              <Field
                id="token-name"
                label="Token name"
                hint="Shown in the token list and audit log. Use the consumer's name (e.g. 'github-actions')."
              >
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  autoComplete="off"
                  placeholder="github-actions"
                />
              </Field>

              <div className="space-y-2">
                <div className="label-mono">Expires</div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {EXPIRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value || "never"}
                      type="button"
                      onClick={() => setExpiresIn(opt.value)}
                      className={cn(
                        "h-9 rounded-[var(--radius-sm)] border text-[12px] font-mono",
                        expiresIn === opt.value
                          ? "border-signal bg-[color:var(--signal-soft)]/30 text-ink-1"
                          : "border-line-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="label-mono">Scopes</div>
                  <SuperAdminToggle on={superAdmin} onChange={setSuperAdmin} />
                </div>
                {superAdmin ? (
                  <Alert tone="warn" title="Full admin access">
                    This token bypasses scope checks and can perform any action against the team —
                    including deleting it. Use sparingly.
                  </Alert>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {RESOURCES.map((r) => (
                      <ScopeCard
                        key={r.key}
                        resource={r.key}
                        label={r.label}
                        description={r.description}
                        supportsWrite={r.supportsWrite}
                        level={levels[r.key]}
                        onChange={(lv) =>
                          setLevels((prev) => ({ ...prev, [r.key]: lv }))
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">Cancel</Button>
              </DialogClose>
              <Button type="submit" loading={create.isPending}>
                Generate token
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScopeCard({
  label,
  description,
  supportsWrite,
  level,
  onChange,
}: {
  resource: Resource;
  label: string;
  description: string;
  supportsWrite: boolean;
  level: Level;
  onChange: (level: Level) => void;
}) {
  const levels: { value: Level; label: string }[] = supportsWrite
    ? [
        { value: "none",  label: "None" },
        { value: "read",  label: "Read" },
        { value: "write", label: "Write" },
      ]
    : [
        { value: "none",  label: "None" },
        { value: "read",  label: "Read" },
      ];

  return (
    <div className="rounded-[var(--radius-sm)] border border-line-1 bg-surface-1/40 p-3 space-y-2">
      <div>
        <div className="text-[13px] text-ink-1 font-medium">{label}</div>
        <div className="text-[11px] text-ink-3 leading-snug">{description}</div>
      </div>
      <div className="flex items-center gap-1 -mx-0.5">
        {levels.map((lv) => {
          const selected = level === lv.value;
          return (
            <button
              key={lv.value}
              type="button"
              onClick={() => onChange(lv.value)}
              className={cn(
                "flex-1 h-7 rounded-[3px] text-[11px] font-mono uppercase tracking-[0.14em] transition-colors",
                selected
                  ? "bg-signal text-[color:var(--signal-ink)]"
                  : "text-ink-3 hover:text-ink-1 hover:bg-surface-2",
              )}
            >
              {lv.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SuperAdminToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex items-center gap-2 h-7 px-2.5 rounded-[var(--radius-sm)]",
        "font-mono uppercase tracking-[0.14em] text-[10px] transition-colors",
        on
          ? "bg-alert/15 text-alert border border-alert/30"
          : "border border-line-1 text-ink-3 hover:text-ink-1 hover:bg-surface-2",
      )}
    >
      <ShieldAlert className="h-3 w-3" />
      Full admin (*)
    </button>
  );
}

function RevealPane({ token, onClose }: { token: ApiToken; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!token.token) return;
    try {
      await navigator.clipboard.writeText(token.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  }

  return (
    <>
      <DialogHeader>
        <DialogEyebrow>Access · reveal</DialogEyebrow>
        <DialogTitle>Token issued</DialogTitle>
        <DialogDescription>
          Copy this value now — it&rsquo;s only shown once. After you close this dialog
          we keep only a SHA-256 hash; if you lose the value you&rsquo;ll need to issue a new token.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div>
          <div className="label-mono mb-1.5">Token value</div>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 min-w-0 rounded-[var(--radius-sm)] bg-surface-2 border border-line-1 px-3 py-2.5 font-mono text-[12px] text-ink-1 break-all">
              {token.token}
            </code>
            <button
              type="button"
              onClick={copy}
              className={cn(
                "shrink-0 h-auto px-3 inline-flex items-center gap-2 rounded-[var(--radius-sm)] border transition-colors",
                copied
                  ? "border-online text-online"
                  : "border-line-1 text-ink-2 hover:bg-surface-2 hover:text-ink-1",
              )}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
                {copied ? "Copied" : "Copy"}
              </span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <Row label="Name"><span className="font-mono text-ink-1">{token.name}</span></Row>
          <Row label="Created"><span className="font-mono text-ink-1 num">{formatDate(token.created_at)}</span></Row>
          <Row label="Expires">
            <span className="font-mono text-ink-1 num">
              {token.expires_at ? formatDate(token.expires_at) : "Never"}
            </span>
          </Row>
          <Row label="Scopes">
            <div className="flex flex-wrap gap-1">
              {token.scopes.map((s) => (
                <Badge key={s} tone="outline">{s}</Badge>
              ))}
            </div>
          </Row>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="label-mono">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
