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

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Passphrase must be at least 8 characters.");
    if (password !== confirm) return setError("Passphrases don't match.");
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      router.replace("/login?reset=ok");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Reset failed. The link may be expired — request a new one.",
      );
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-7" noValidate>
      {error && (
        <div className="reveal">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <div className="space-y-6 reveal reveal-4">
        <Field id="password" label="New passphrase" hint="Minimum 8 characters.">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoFocus
            autoComplete="new-password"
          />
        </Field>
        <Field id="confirm" label="Confirm">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
      </div>
      <div className="reveal reveal-5 flex items-center justify-between gap-4 pt-2">
        <Button type="submit" size="lg" loading={loading} className="min-w-[200px]">
          Set new passphrase
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Link href="/login" className="text-[12px] text-ink-3 hover:text-signal">
          Back to sign in
        </Link>
      </div>
    </form>
  );
}
