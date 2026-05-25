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

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Passphrase must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      await authApi.signup(name, email, password);
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Sign-up failed. Try again or contact support.",
      );
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-7" noValidate>
      {error && (
        <div className="reveal">
          <Alert tone="error" title="Sign-up failed">{error}</Alert>
        </div>
      )}

      <div className="space-y-6 reveal reveal-4">
        <Field id="name" label="Operator name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            autoComplete="name"
            placeholder="Ada Lovelace"
          />
        </Field>

        <Field id="email" label="Operator email">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@nixway.dev"
          />
        </Field>

        <Field
          id="password"
          label="Passphrase"
          hint="Minimum 8 characters. We store the bcrypt hash, never the raw value."
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </Field>
      </div>

      <div className="reveal reveal-5 flex items-center justify-between gap-4 pt-2">
        <Button type="submit" size="lg" loading={loading} className="min-w-[200px]">
          Create account
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <div className="text-[12px] text-ink-3">
          Already on board?{" "}
          <Link href="/login" className="text-signal hover:underline underline-offset-4">
            Sign in
          </Link>
        </div>
      </div>
    </form>
  );
}
