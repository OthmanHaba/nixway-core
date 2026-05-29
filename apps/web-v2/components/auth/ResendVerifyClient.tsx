"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Mail } from "lucide-react";
import { Alert } from "@/components/primitives/Alert";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { authApi, ApiError } from "@/lib/api";

export function ResendVerifyClient() {
  const sp = useSearchParams();
  const [email, setEmail] = useState(sp.get("email") ?? "");
  const [state, setState] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setState("loading");
    setError(null);
    try {
      await authApi.resendVerification(email);
      setState("sent");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not send. Try again in a moment.",
      );
      setState("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {state === "sent" && (
        <div className="reveal">
          <Alert tone="success" title="Verification email sent">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Check {email} for a fresh link. It may take a minute to arrive.
            </span>
          </Alert>
        </div>
      )}
      {state === "error" && error && (
        <div className="reveal">
          <Alert tone="error" title="Couldn't resend">{error}</Alert>
        </div>
      )}

      <Field id="email" label="Operator email">
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="you@nixway.dev"
        />
      </Field>

      <div className="flex items-center justify-between gap-4 pt-2">
        <Button type="submit" size="lg" loading={state === "loading"} className="min-w-[200px]">
          <Mail className="h-3.5 w-3.5" />
          Resend verification
        </Button>
        <div className="text-[12px] text-ink-3">
          Already verified?{" "}
          <Link href="/login" className="text-signal hover:underline underline-offset-4">
            Sign in
          </Link>
        </div>
      </div>
    </form>
  );
}
