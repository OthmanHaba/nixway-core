"use client";

import { useState } from "react";
import { Copy, Check, KeyRound } from "lucide-react";
import { Alert } from "@/components/primitives/Alert";
import type { DatabaseProvisionResult } from "@/lib/types";

interface Props {
  result: DatabaseProvisionResult;
}

/**
 * Reveal-once credentials surfaced after a successful provision. The
 * superuser and app-user passwords come back inside the 202 response and are
 * never returned again — operators must copy them now or rotate later.
 */
export function CredentialsReveal({ result }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }
  return (
    <div className="space-y-3">
      <Alert tone="warn">
        These passwords are shown <strong>once</strong>. Copy them now — to
        recover access later you&rsquo;ll have to rotate the credentials.
      </Alert>
      <div className="rounded-[var(--radius-md)] border border-line-1 bg-surface-1 p-3 space-y-3">
        <div className="label-mono inline-flex items-center gap-2">
          <KeyRound className="h-3 w-3" /> Generated credentials
        </div>
        <CredRow
          label="Superuser password"
          value={result.superuser_password}
          copied={copied}
          onCopy={copy}
        />
        <CredRow
          label="App-user password"
          value={result.appuser_password}
          copied={copied}
          onCopy={copy}
        />
      </div>
    </div>
  );
}

function CredRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: string | null;
  onCopy: (label: string, value: string) => void;
}) {
  const isCopied = copied === label;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="label-mono">{label}</div>
        <div className="font-mono text-[12px] text-ink-1 truncate">{value}</div>
      </div>
      <button
        type="button"
        onClick={() => onCopy(label, value)}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-line-1 px-2 h-7 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
      >
        {isCopied ? (
          <>
            <Check className="h-3 w-3 text-online" /> Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" /> Copy
          </>
        )}
      </button>
    </div>
  );
}
