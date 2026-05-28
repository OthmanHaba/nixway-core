"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Globe } from "lucide-react";
import { Card, CardBody, CardHeader, CardFooter } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Badge } from "@/components/primitives/Badge";
import { Alert } from "@/components/primitives/Alert";
import { appsApi, ApiError } from "@/lib/api";
import type { App } from "@/lib/types";

export function DomainCard({ app }: { app: App }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState(app.custom_domain ?? "");
  const [error, setError] = useState<string | null>(null);

  const set = useMutation({
    mutationFn: (d: string) => appsApi.setDomain(app.id, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app", app.id] });
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not set domain.");
    },
  });

  const verify = useMutation({
    mutationFn: () => appsApi.verifyDomain(app.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app", app.id] });
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Domain verification failed.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = domain.trim();
    if (!trimmed) return setError("Enter a domain.");
    set.mutate(trimmed);
  }

  const verified = !!app.custom_domain_verified;

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Globe className="h-3 w-3" /> Domain
          </div>
          <h2 className="text-[16px] text-ink-1">Custom domain</h2>
          <p className="mt-1 text-[12px] text-ink-3 max-w-md">
            Point a CNAME (or A record) at the platform ingress, then verify here. Traffic from
            the verified domain reaches your app over the cluster mesh.
          </p>
        </CardHeader>
        <CardBody className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <Field
            id="app-domain"
            label="Hostname"
            trailing={
              app.custom_domain ? (
                verified ? (
                  <Badge tone="online" dot>Verified</Badge>
                ) : (
                  <Badge tone="warn" dot>Unverified</Badge>
                )
              ) : undefined
            }
          >
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              autoComplete="off"
              placeholder="api.example.com"
              maxLength={253}
            />
          </Field>
        </CardBody>
        <CardFooter>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
            {verified ? "DNS confirmed" : "Set, then verify"}
          </span>
          <div className="flex items-center gap-2">
            {app.custom_domain && !verified && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => verify.mutate()}
                loading={verify.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Verify DNS
              </Button>
            )}
            <Button
              type="submit"
              loading={set.isPending}
              disabled={!domain.trim() || domain.trim() === (app.custom_domain ?? "")}
            >
              Save domain
            </Button>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
