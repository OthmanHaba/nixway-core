"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Alert } from "@/components/primitives/Alert";
import { Button } from "@/components/primitives/Button";
import { api, ApiError, authApi } from "@/lib/api";

type State = "checking" | "accepting" | "ok" | "needs-login" | "error";

export function AcceptInviteClient({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Confirm we're logged in. If not, send the user to /login with a
    // returnTo that brings them back to accept the invite afterwards.
    authApi
      .me()
      .then(async () => {
        if (cancelled) return;
        setState("accepting");
        try {
          await api.post<{ status: string }>("/invites/accept", { token });
          if (!cancelled) setState("ok");
        } catch (err) {
          if (cancelled) return;
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not accept invite. The link may have expired.",
          );
          setState("error");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState("needs-login");
        router.replace(`/login?returnTo=${encodeURIComponent(`/invites/accept/${token}`)}`);
      });

    return () => { cancelled = true; };
  }, [token, router]);

  if (state === "checking" || state === "accepting" || state === "needs-login") {
    const label = state === "needs-login" ? "Redirecting to sign in …" : "Accepting invite …";
    return (
      <div className="flex items-center gap-3 text-ink-2 reveal">
        <Loader2 className="h-4 w-4 animate-spin text-signal" />
        <span className="font-mono text-[12px] uppercase tracking-[0.14em]">{label}</span>
      </div>
    );
  }

  if (state === "ok") {
    return (
      <div className="space-y-6 reveal">
        <Alert tone="success" title="Invite accepted">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" />
            You&rsquo;re in. Heading to the dashboard.
          </span>
        </Alert>
        <Button asChild>
          <Link href="/dashboard">Open dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 reveal">
      <Alert tone="error" title="Could not accept invite">
        <span className="inline-flex items-center gap-2">
          <XCircle className="h-3.5 w-3.5" />
          {error}
        </span>
      </Alert>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-2 hover:text-signal"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
