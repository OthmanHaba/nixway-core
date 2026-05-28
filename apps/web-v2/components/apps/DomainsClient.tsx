"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { Badge } from "@/components/primitives/Badge";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { appsApi, ApiError } from "@/lib/api";
import type { App, VerifyDomainResult } from "@/lib/types";
import { cn } from "@/lib/cn";

interface Props {
  app: App;
  platformDomain: string | null;
  serverIps: string[];
}

export function DomainsClient({ app, platformDomain, serverIps }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [domain, setDomain] = useState(app.custom_domain ?? "");
  const [lastVerify, setLastVerify] = useState<VerifyDomainResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verified = !!app.custom_domain_verified;
  const trimmed = domain.trim();
  const unchanged = trimmed === (app.custom_domain ?? "");

  const set = useMutation({
    mutationFn: (d: string) => appsApi.setDomain(app.id, d),
    onSuccess: () => {
      setLastVerify(null);
      queryClient.invalidateQueries({ queryKey: ["app", app.id] });
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not set domain.");
    },
  });

  const verify = useMutation({
    mutationFn: () => appsApi.verifyDomain(app.id),
    onSuccess: (res) => {
      setLastVerify(res);
      queryClient.invalidateQueries({ queryKey: ["app", app.id] });
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Domain verification failed.");
    },
  });

  const remove = useMutation({
    mutationFn: () => appsApi.removeDomain(app),
    onSuccess: () => {
      setDomain("");
      setLastVerify(null);
      queryClient.invalidateQueries({ queryKey: ["app", app.id] });
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not remove domain.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!trimmed) return setError("Enter a hostname.");
    if (unchanged) return;
    set.mutate(trimmed);
  }

  const platformUrl = platformDomain ? `https://${platformDomain}` : null;
  const customUrl = app.custom_domain ? `https://${app.custom_domain}` : null;

  return (
    <div className="space-y-6 max-w-[920px]">
      {/* Platform URL */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1 flex items-center gap-2">
            <Globe className="h-3 w-3" /> Platform URL
          </div>
          <h2 className="text-[16px] text-ink-1">Auto-assigned hostname</h2>
          <p className="mt-1 text-[12px] text-ink-3 max-w-md">
            Every healthy deployment is reachable at a platform-managed hostname
            — fronted by Cloudflare with automatic TLS.
          </p>
        </CardHeader>
        <CardBody className="space-y-3">
          {platformUrl ? (
            <UrlRow url={platformUrl} domain={platformDomain!} tone="signal" />
          ) : (
            <p className="text-[13px] text-ink-3">
              No healthy deployment yet — once an app ships, its platform URL appears here.
            </p>
          )}
        </CardBody>
      </Card>

      {/* Custom domain editor */}
      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <div className="label-mono mb-1">Custom domain</div>
            <h2 className="text-[16px] text-ink-1">Bring your own hostname</h2>
            <p className="mt-1 text-[12px] text-ink-3 max-w-md">
              Attach a domain you own. Point DNS at the platform, then verify —
              we&rsquo;ll route requests for the verified hostname into this app
              over the cluster mesh.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            {error && <Alert tone="error">{error}</Alert>}
            {set.isSuccess && !error && !set.isPending && unchanged && (
              <Alert tone="success">Saved. Run DNS verification below.</Alert>
            )}

            <Field
              id="custom-domain"
              label="Hostname"
              trailing={
                app.custom_domain ? (
                  verified ? (
                    <Badge tone="online" dot>
                      Verified
                    </Badge>
                  ) : (
                    <Badge tone="warn" dot>
                      Unverified
                    </Badge>
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
                spellCheck={false}
              />
            </Field>

            {customUrl && verified && (
              <UrlRow url={customUrl} domain={app.custom_domain!} tone="online" />
            )}

            {lastVerify && (
              <VerifyBanner result={lastVerify} />
            )}
          </CardBody>
          <CardFooter>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4 mr-auto">
              {unchanged
                ? verified
                  ? "DNS confirmed"
                  : app.custom_domain
                    ? "Awaiting verification"
                    : "No domain set"
                : "Unsaved"}
            </span>

            <div className="flex items-center gap-2">
              {app.custom_domain && (
                <ConfirmDialog
                  title="Remove this custom domain?"
                  description={
                    <>
                      Traffic for <span className="text-ink-1">{app.custom_domain}</span>{" "}
                      will stop reaching this app on the next deployment. You can re-attach
                      the same hostname later — it&rsquo;ll need to be verified again.
                    </>
                  }
                  confirmLabel="Remove domain"
                  destructive
                  onConfirm={() =>
                    new Promise<void>((resolve, reject) =>
                      remove.mutate(undefined, {
                        onSuccess: () => resolve(),
                        onError: (e) => reject(e),
                      }),
                    )
                  }
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      loading={remove.isPending}
                      className="text-alert"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </Button>
                  }
                />
              )}
              {app.custom_domain && !verified && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setError(null);
                    verify.mutate();
                  }}
                  loading={verify.isPending}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Verify DNS
                </Button>
              )}
              <Button
                type="submit"
                loading={set.isPending}
                disabled={!trimmed || unchanged}
              >
                {app.custom_domain ? "Update" : "Save domain"}
              </Button>
            </div>
          </CardFooter>
        </form>
      </Card>

      {/* DNS setup */}
      <Card>
        <CardHeader>
          <div className="label-mono mb-1">DNS setup</div>
          <h2 className="text-[16px] text-ink-1">Where to point your domain</h2>
          <p className="mt-1 text-[12px] text-ink-3 max-w-md">
            Pick whichever your registrar makes easiest. CNAME is recommended —
            it tracks platform infrastructure changes automatically.
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          <DnsRow
            type="CNAME"
            host={trimmed || app.custom_domain || "api.example.com"}
            target={platformDomain || "(deploy first to reveal target)"}
            recommended
          />

          {serverIps.length > 0 && (
            <div className="space-y-1.5">
              <div className="label-mono">A records (advanced)</div>
              <p className="text-[12px] text-ink-3 max-w-md">
                Resolve to one of the cluster&rsquo;s public IPs. Use multiple
                records for redundancy.
              </p>
              <ul className="rounded-[var(--radius-md)] border border-line-1 divide-y divide-line-1 bg-surface-1 overflow-hidden">
                {serverIps.map((ip) => (
                  <li key={ip} className="px-3 py-2 flex items-center justify-between">
                    <span className="font-mono text-[12px] text-ink-1 num">{ip}</span>
                    <CopyChip text={ip} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function UrlRow({
  url,
  domain,
  tone,
}: {
  url: string;
  domain: string;
  tone: "signal" | "online";
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2.5",
        tone === "signal"
          ? "border-[color:var(--signal)]/40 bg-[color:var(--signal-soft)]/15"
          : "border-line-1 bg-surface-1",
      )}
    >
      <div className="min-w-0">
        <div className="label-mono text-ink-3 mb-0.5">{tone === "online" ? "Custom" : "Platform"}</div>
        <div className="font-mono text-[13px] text-ink-1 truncate">{domain}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <CopyChip text={domain} />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-line-1 hover:bg-surface-2 text-ink-2 hover:text-ink-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors"
        >
          <ExternalLink className="h-3 w-3" /> Open
        </a>
      </div>
    </div>
  );
}

function DnsRow({
  type,
  host,
  target,
  recommended,
}: {
  type: string;
  host: string;
  target: string;
  recommended?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-line-1 bg-surface-1 overflow-hidden">
      <div className="px-3 py-2 border-b border-line-1 flex items-center justify-between bg-surface-2/40">
        <div className="flex items-center gap-2">
          <Badge tone="outline">{type}</Badge>
          {recommended && <Badge tone="signal">recommended</Badge>}
        </div>
      </div>
      <dl className="grid grid-cols-[80px_1fr_auto] gap-x-3 gap-y-1.5 px-3 py-2.5 items-center">
        <dt className="label-mono">Host</dt>
        <dd className="font-mono text-[12px] text-ink-1 truncate">{host}</dd>
        <dd>
          <CopyChip text={host} />
        </dd>
        <dt className="label-mono">Points to</dt>
        <dd className="font-mono text-[12px] text-ink-1 truncate">{target}</dd>
        <dd>{target.startsWith("(") ? <span /> : <CopyChip text={target} />}</dd>
      </dl>
    </div>
  );
}

function VerifyBanner({ result }: { result: VerifyDomainResult }) {
  if (result.verified) {
    return (
      <Alert tone="success">
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5" />
          DNS for <span className="font-mono text-ink-1">{result.domain}</span> resolved to{" "}
          <span className="font-mono text-ink-1">{result.target || "—"}</span>. Domain is live.
        </span>
      </Alert>
    );
  }
  return (
    <Alert tone="warn">
      <span className="inline-flex items-center gap-2">
        <ShieldAlert className="h-3.5 w-3.5" />
        Could not verify <span className="font-mono text-ink-1">{result.domain}</span>. DNS may
        still be propagating — typical TTL is 5–60 minutes.
      </span>
    </Alert>
  );
}

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore — older browsers */
        }
      }}
      className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-line-1 hover:bg-surface-2 text-ink-2 hover:text-ink-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors"
      aria-label="Copy"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" /> Copy
        </>
      )}
    </button>
  );
}

