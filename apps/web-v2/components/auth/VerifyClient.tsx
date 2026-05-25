"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Alert } from "@/components/primitives/Alert";
import { authApi, ApiError } from "@/lib/api";

type State = "verifying" | "ok" | "error";

export function VerifyClient({ token }: { token: string }) {
  const [state, setState] = useState<State>("verifying");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi
      .verifyEmail(token)
      .then(() => { if (!cancelled) setState("ok"); })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Verification failed. The link may have expired.",
        );
        setState("error");
      });
    return () => { cancelled = true; };
  }, [token]);

  if (state === "verifying") {
    return (
      <div className="flex items-center gap-3 text-ink-2 reveal">
        <Loader2 className="h-4 w-4 animate-spin text-signal" />
        <span className="font-mono text-[12px] uppercase tracking-[0.14em]">
          Validating token …
        </span>
      </div>
    );
  }
  if (state === "ok") {
    return (
      <div className="space-y-6 reveal">
        <Alert tone="success" title="Email verified">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Your operator account is now active.
          </span>
        </Alert>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-signal hover:underline underline-offset-4"
        >
          Continue to sign in →
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-6 reveal">
      <Alert tone="error" title="Could not verify">
        <span className="inline-flex items-center gap-2">
          <XCircle className="h-3.5 w-3.5" />
          {error}
        </span>
      </Alert>
      <Link
        href="/login"
        className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-2 hover:text-signal"
      >
        Back to sign in
      </Link>
    </div>
  );
}
