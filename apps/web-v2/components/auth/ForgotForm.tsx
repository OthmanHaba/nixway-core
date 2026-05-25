"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { authApi, ApiError } from "@/lib/api";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      // Don't expose whether the email exists; still show success state.
      if (err instanceof ApiError && err.status >= 500) {
        setError("Reset service is offline. Try again shortly.");
      } else {
        setSent(true);
      }
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-6 reveal">
        <Alert tone="success" title="Check your inbox">
          If <span className="font-mono">{email}</span> matches an account, a reset link is on its way.
          The token expires in 30 minutes.
        </Alert>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-2 hover:text-signal transition-colors"
        >
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-7" noValidate>
      {error && (
        <div className="reveal">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <div className="reveal reveal-4">
        <Field id="email" label="Operator email">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            placeholder="you@nixway.dev"
          />
        </Field>
      </div>
      <div className="reveal reveal-5 flex items-center justify-between gap-4 pt-2">
        <Button type="submit" size="lg" loading={loading} className="min-w-[200px]">
          Send reset link
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Link href="/login" className="text-[12px] text-ink-3 hover:text-signal">
          Back to sign in
        </Link>
      </div>
    </form>
  );
}
