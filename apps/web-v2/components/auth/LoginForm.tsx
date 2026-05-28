"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { authApi, ApiError } from "@/lib/api";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.login(email, password);
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Sign-in failed. Check your credentials and try again.",
      );
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-7" noValidate>
      {error && (
        <div className="reveal">
          <Alert tone="error" title="Sign-in failed">{error}</Alert>
        </div>
      )}

      <div className="space-y-6 reveal reveal-4">
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

        <Field
          id="password"
          label="Passphrase"
          trailing={
            <Link
              href="/forgot-password"
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 hover:text-signal transition-colors"
            >
              Reset
            </Link>
          }
        >
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </Field>
      </div>

      <div className="reveal reveal-5 flex items-center justify-between gap-4 pt-2">
        <Button type="submit" size="lg" loading={loading} className="min-w-[200px]">
          Authenticate
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <div className="text-[12px] text-ink-3">
          New here?{" "}
          <Link href="/signup" className="text-signal hover:underline underline-offset-4">
            Create account
          </Link>
        </div>
      </div>
    </form>
  );
}
