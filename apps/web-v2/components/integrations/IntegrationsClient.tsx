"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Github,
  Boxes,
  Plug,
  PlugZap,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Container,
} from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Badge } from "@/components/primitives/Badge";
import { Alert } from "@/components/primitives/Alert";
import { EmptyState } from "@/components/primitives/EmptyState";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { RegistryDialog } from "./RegistryDialog";
import { githubApi, registriesApi, ApiError } from "@/lib/api";
import type { Team, GithubInstallation, RegistryCredential } from "@/lib/types";

const TYPE_LABELS: Record<string, string> = {
  dockerhub: "Docker Hub",
  ghcr: "GitHub Container Registry",
  ecr: "Amazon ECR",
  generic: "Generic",
};

interface Props {
  activeTeam: Team | null;
}

export function IntegrationsClient({ activeTeam }: Props) {
  if (!activeTeam) {
    return (
      <EmptyState
        icon={<Plug className="h-4 w-4" />}
        title="No active team"
        body="Pick or create a team first — integrations are scoped per team."
      />
    );
  }
  return (
    <div className="space-y-6 max-w-[960px]">
      <GitHubPanel teamId={activeTeam.id} />
      <RegistriesPanel teamId={activeTeam.id} />
    </div>
  );
}

function ConnectivityBadge({
  loading,
  connected,
  ok,
  checking,
  notConnected,
}: {
  loading: boolean;
  connected: boolean;
  ok: boolean;
  checking: boolean;
  notConnected: boolean;
}) {
  if (loading) return <Badge tone="neutral">checking…</Badge>;
  if (notConnected || !connected) return <Badge tone="neutral">Not connected</Badge>;
  if (checking) return <Badge tone="info" dot>checking…</Badge>;
  if (ok) return <Badge tone="online" dot>Operational</Badge>;
  return <Badge tone="warn" dot>Connectivity issue</Badge>;
}

/* ─────────────────────────── GitHub App ─────────────────────────── */

function GitHubPanel({ teamId }: { teamId: string }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);

  const appQ = useQuery({
    queryKey: ["github-app", teamId],
    queryFn: () => githubApi.getApp(teamId),
    retry: false, // a 404 just means "not connected" — don't hammer it
  });

  const notConnected = appQ.error instanceof ApiError && appQ.error.status === 404;
  const app = appQ.data;

  // Listing installations live-reconciles them on the backend, so this query
  // doubles as the connectivity check against GitHub.
  const instQ = useQuery({
    queryKey: ["github-installations", teamId],
    queryFn: () => githubApi.installations(teamId),
    enabled: !!app,
    retry: false,
  });

  const connect = useMutation({
    mutationFn: () => githubApi.createManifest(teamId),
    onSuccess: (res) => {
      // The callback page reads this to know which team to attach the app to.
      localStorage.setItem("nixway_github_team_id", teamId);
      window.location.href = res.redirect_url;
    },
  });

  const disconnect = useMutation({
    mutationFn: () => githubApi.deleteApp(teamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github-app", teamId] });
      qc.invalidateQueries({ queryKey: ["github-installations", teamId] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label-mono mb-1 inline-flex items-center gap-2 text-ink-2">
              <Github className="h-3 w-3" /> Source · GitHub App
            </div>
            <h2 className="text-[16px] text-ink-1">GitHub</h2>
            <p className="mt-1 text-[12px] text-ink-3 max-w-md">
              Connect a GitHub App to deploy from private repositories. Listing installations
              re-checks connectivity with GitHub live.
            </p>
          </div>
          <ConnectivityBadge
            loading={appQ.isLoading}
            connected={!!app}
            // Once an app exists, the installations query is the live signal.
            ok={!!app && !instQ.isError}
            checking={!!app && instQ.isFetching}
            notConnected={notConnected}
          />
        </div>
      </CardHeader>

      <CardBody className="space-y-4">
        {appQ.isError && !notConnected && (
          <Alert tone="error">
            {appQ.error instanceof ApiError ? appQ.error.message : "Failed to load the GitHub App."}
          </Alert>
        )}

        {connect.isError && (
          <Alert tone="error">
            {connect.error instanceof ApiError ? connect.error.message : "Could not start the GitHub App flow."}
          </Alert>
        )}

        {/* Not connected → call to action */}
        {!app && !appQ.isLoading && (
          <div className="flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-dashed border-line-1 px-4 py-5">
            <div className="text-[13px] text-ink-2">
              No GitHub App connected for this team yet.
            </div>
            <Button variant="primary" loading={connect.isPending} onClick={() => connect.mutate()}>
              <PlugZap className="h-3.5 w-3.5" /> Connect GitHub App
            </Button>
          </div>
        )}

        {/* Connected → app summary + installations */}
        {app && (
          <>
            <div className="flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-line-1 bg-surface-1/40 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-ink-1 font-medium truncate">{app.app_name}</span>
                  <Badge tone="online" dot>Connected</Badge>
                </div>
                <div className="font-mono text-[11px] text-ink-3 mt-0.5">app id {app.app_id} · {app.app_slug}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a href={app.html_url} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm"><ExternalLink className="h-3.5 w-3.5" /> GitHub</Button>
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={instQ.isFetching}
                  onClick={() => instQ.refetch()}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Check connectivity
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm" className="text-alert">
                      <Trash2 className="h-3.5 w-3.5" /> Disconnect
                    </Button>
                  }
                  title="Disconnect GitHub App?"
                  description="Apps deploying from private repos via this app will no longer build. You can reconnect anytime."
                  destructive
                  confirmLabel="Disconnect"
                  loading={disconnect.isPending}
                  onConfirm={() => disconnect.mutateAsync()}
                />
              </div>
            </div>

            {instQ.isError && (
              <Alert tone="warn">
                Couldn&rsquo;t reach GitHub to list installations:{" "}
                {instQ.error instanceof ApiError ? instQ.error.message : "connectivity error"}.
              </Alert>
            )}

            <div>
              <div className="label-mono mb-2 text-ink-3">Installations &amp; repositories</div>
              {instQ.isLoading ? (
                <div className="text-[12px] text-ink-3 px-1 py-3">Loading installations…</div>
              ) : (instQ.data?.length ?? 0) === 0 ? (
                <div className="rounded-[var(--radius-md)] border border-dashed border-line-1 px-4 py-4 text-[12px] text-ink-3">
                  No installations yet. Install the app on a GitHub account/org, then re-check connectivity.
                  <a href={app.html_url} target="_blank" rel="noreferrer" className="ml-1 text-info inline-flex items-center gap-1">
                    Install <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {instQ.data!.map((inst) => (
                    <InstallationRow
                      key={inst.id}
                      teamId={teamId}
                      inst={inst}
                      open={expanded === inst.installation_id}
                      onToggle={() =>
                        setExpanded(expanded === inst.installation_id ? null : inst.installation_id)
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function InstallationRow({
  teamId,
  inst,
  open,
  onToggle,
}: {
  teamId: string;
  inst: GithubInstallation;
  open: boolean;
  onToggle: () => void;
}) {
  const reposQ = useQuery({
    queryKey: ["github-repos", teamId, inst.installation_id],
    queryFn: () => githubApi.repos(teamId, inst.installation_id),
    enabled: open,
    retry: false,
  });

  return (
    <li className="rounded-[var(--radius-md)] border border-line-1 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-2 transition-colors text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <ChevronRight className={`h-3.5 w-3.5 text-ink-3 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="text-[13px] text-ink-1 truncate">{inst.account_login}</span>
          <Badge tone="neutral">{inst.account_type}</Badge>
          {inst.suspended_at && <Badge tone="warn">suspended</Badge>}
        </span>
        <span className="font-mono text-[10px] text-ink-4">#{inst.installation_id}</span>
      </button>
      {open && (
        <div className="border-t border-line-1 px-3 py-2 bg-[#0c0d12]/40">
          {reposQ.isLoading ? (
            <div className="text-[12px] text-ink-3 py-1">Loading repositories…</div>
          ) : reposQ.isError ? (
            <div className="text-[12px] text-alert py-1">
              {reposQ.error instanceof ApiError ? reposQ.error.message : "Failed to load repositories."}
            </div>
          ) : (reposQ.data?.length ?? 0) === 0 ? (
            <div className="text-[12px] text-ink-3 py-1">No repositories accessible to this installation.</div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 py-1">
              {reposQ.data!.map((repo) => (
                <li key={repo.id} className="flex items-center gap-2 min-w-0 text-[12px]">
                  <span className="font-mono text-ink-2 truncate">{repo.full_name}</span>
                  {repo.private && <Badge tone="neutral">private</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/* ─────────────────────────── Registries ─────────────────────────── */

function RegistriesPanel({ teamId }: { teamId: string }) {
  const listQ = useQuery({
    queryKey: ["registries", teamId],
    queryFn: () => registriesApi.list(teamId),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label-mono mb-1 inline-flex items-center gap-2 text-ink-2">
              <Boxes className="h-3 w-3" /> Registries · image pulls
            </div>
            <h2 className="text-[16px] text-ink-1">Container registries</h2>
            <p className="mt-1 text-[12px] text-ink-3 max-w-md">
              Credentials for pulling private images (Docker Hub, GHCR, ECR, or any registry) at
              build and deploy time. Validated on save and on demand.
            </p>
          </div>
          <RegistryDialog
            teamId={teamId}
            trigger={
              <Button variant="primary" size="sm">
                <Plug className="h-3.5 w-3.5" /> Add registry
              </Button>
            }
          />
        </div>
      </CardHeader>

      <CardBody>
        {listQ.isError && (
          <Alert tone="error">
            {listQ.error instanceof ApiError ? listQ.error.message : "Failed to load registries."}
          </Alert>
        )}
        {listQ.isLoading ? (
          <div className="text-[12px] text-ink-3 px-1 py-3">Loading registries…</div>
        ) : (listQ.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Container className="h-4 w-4" />}
            title="No registries"
            body="Add a credential to pull private images. Public images don't need one."
          />
        ) : (
          <ul className="space-y-1.5">
            {listQ.data!.map((reg) => (
              <RegistryRow key={reg.id} teamId={teamId} reg={reg} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function RegistryRow({ teamId, reg }: { teamId: string; reg: RegistryCredential }) {
  const qc = useQueryClient();
  const [validateErr, setValidateErr] = useState<string | null>(null);

  const validate = useMutation({
    mutationFn: () => registriesApi.validate(teamId, reg.id),
    onMutate: () => setValidateErr(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registries", teamId] }),
    onError: (e) =>
      setValidateErr(e instanceof ApiError ? e.message : "Validation failed."),
  });

  const remove = useMutation({
    mutationFn: () => registriesApi.remove(teamId, reg.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registries", teamId] }),
  });

  return (
    <li className="rounded-[var(--radius-md)] border border-line-1 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-ink-1 font-medium truncate">{reg.name}</span>
            <Badge tone="neutral">{TYPE_LABELS[reg.registry_type] ?? reg.registry_type}</Badge>
            {reg.validated_at ? (
              <Badge tone="online" dot>verified</Badge>
            ) : (
              <Badge tone="warn">unverified</Badge>
            )}
          </div>
          <div className="font-mono text-[11px] text-ink-3 mt-0.5 truncate">
            {reg.registry_url}
            {reg.username ? ` · ${reg.username}` : ""}
            {reg.region ? ` · ${reg.region}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" loading={validate.isPending} onClick={() => validate.mutate()}>
            {validateErr ? (
              <AlertTriangle className="h-3.5 w-3.5 text-alert" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Test
          </Button>
          <RegistryDialog
            teamId={teamId}
            existing={reg}
            trigger={<Button variant="ghost" size="sm">Edit</Button>}
          />
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="text-alert">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            }
            title={`Remove ${reg.name}?`}
            description="Apps using this credential will fail to pull their image until you attach another."
            destructive
            confirmLabel="Remove"
            loading={remove.isPending}
            onConfirm={() => remove.mutateAsync()}
          />
        </div>
      </div>
      {validateErr && <div className="mt-2 text-[12px] text-alert">{validateErr}</div>}
    </li>
  );
}
