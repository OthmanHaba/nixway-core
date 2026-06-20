"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Github, Box, Star, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogEyebrow,
  DialogClose,
} from "@/components/primitives/Dialog";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { Combobox, type ComboboxItem } from "@/components/primitives/Combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/primitives/Select";
import { appsApi, githubApi, dockerHubApi, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

type Source = "github" | "docker_image";

export function CreateAppDialog({
  projectId,
  teamId,
  trigger,
}: {
  projectId: string;
  teamId?: string;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Source pick
  const [source, setSource] = useState<Source>("github");

  // Common
  const [name, setName] = useState("");
  const [port, setPort] = useState("3000");
  const [replicas, setReplicas] = useState("1");
  const [healthCheckPath, setHealthCheckPath] = useState("/");

  // GitHub
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [installationId, setInstallationId] = useState(""); // installation row UUID
  const [repoManual, setRepoManual] = useState(false);

  // Docker
  const [image, setImage] = useState(""); // image name (picker) or full ref (manual)
  const [tag, setTag] = useState("latest");
  const [imageManual, setImageManual] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // ─── GitHub installations + repos ───
  const installationsQ = useQuery({
    queryKey: ["github-installations", teamId],
    queryFn: () => githubApi.installations(teamId!),
    enabled: open && source === "github" && !!teamId,
    staleTime: 60_000,
  });
  const installations = installationsQ.data ?? [];

  // Auto-select the only installation, or keep prior selection if still valid.
  useEffect(() => {
    if (installations.length === 0) return;
    if (!installations.some((i) => i.id === installationId)) {
      setInstallationId(installations[0].id);
    }
  }, [installations, installationId]);

  const selectedInstallation = installations.find((i) => i.id === installationId) ?? null;

  // Explicit GitHub connection states, so the repo control is never a dead,
  // empty "select" that does nothing. Each maps to a distinct piece of UI.
  const noTeam = !teamId;
  const installationsLoading = installationsQ.isLoading; // first load while enabled
  // The installations endpoint 404s when no GitHub App is connected to the team.
  const noAppConnected =
    installationsQ.isError &&
    installationsQ.error instanceof ApiError &&
    installationsQ.error.status === 404;
  const installationsFailed = installationsQ.isError && !noAppConnected; // token/API error
  const appButNoInstalls = installationsQ.isSuccess && installations.length === 0;
  const hasInstalls = installations.length > 0;

  const reposQ = useQuery({
    queryKey: ["github-repos", teamId, selectedInstallation?.installation_id],
    queryFn: () => githubApi.repos(teamId!, selectedInstallation!.installation_id),
    enabled:
      open &&
      source === "github" &&
      !repoManual &&
      !!teamId &&
      !!selectedInstallation,
    staleTime: 60_000,
  });
  const repoItems: ComboboxItem[] = useMemo(
    () =>
      (reposQ.data ?? []).map((r) => ({
        value: r.full_name,
        label: r.full_name,
        hint: `${r.private ? "private" : "public"} · ${r.default_branch}`,
      })),
    [reposQ.data],
  );

  // Re-reconcile the connected GitHub App against GitHub and reload repos. The
  // installations endpoint live-syncs server-side, so refetching is enough to
  // pick up a freshly installed app or newly granted repos.
  const refreshGithub = useCallback(() => {
    if (!teamId) return;
    queryClient.invalidateQueries({ queryKey: ["github-installations", teamId] });
    queryClient.invalidateQueries({ queryKey: ["github-repos", teamId] });
  }, [queryClient, teamId]);

  const refreshButton = (
    <button
      type="button"
      onClick={refreshGithub}
      className="inline-flex items-center gap-1 text-ink-3 hover:text-signal transition-colors underline underline-offset-2"
    >
      <RefreshCw className={cn("h-3 w-3", installationsQ.isFetching && "animate-spin")} />
      Refresh
    </button>
  );

  // ─── Docker Hub search (remote, debounced) + tags ───
  const [dockerResults, setDockerResults] = useState<ComboboxItem[]>([]);
  const [dockerLoading, setDockerLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  function searchDocker(q: string) {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setDockerResults([]);
      setDockerLoading(false);
      return;
    }
    setDockerLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const res = await dockerHubApi.search(q.trim());
        setDockerResults(
          res.map((img) => ({
            value: img.name,
            label: img.name,
            hint: img.is_official
              ? `official${img.description ? " · " + img.description : ""}`
              : img.description || undefined,
            icon: img.is_official ? (
              <Star className="h-3 w-3 text-signal shrink-0" />
            ) : undefined,
          })),
        );
      } catch {
        setDockerResults([]);
      } finally {
        setDockerLoading(false);
      }
    }, 300);
  }

  const tagsQ = useQuery({
    queryKey: ["docker-tags", image],
    queryFn: () => dockerHubApi.tags(image),
    enabled: open && source === "docker_image" && !imageManual && !!image,
    staleTime: 60_000,
  });
  const tagItems: ComboboxItem[] = useMemo(
    () => (tagsQ.data ?? []).map((t) => ({ value: t.name, label: t.name })),
    [tagsQ.data],
  );

  function reset() {
    setSource("github");
    setName("");
    setPort("3000");
    setReplicas("1");
    setHealthCheckPath("/");
    setRepo("");
    setBranch("main");
    setInstallationId("");
    setRepoManual(false);
    setImage("");
    setTag("latest");
    setImageManual(false);
    setDockerResults([]);
    setDockerLoading(false);
    setError(null);
  }

  const create = useMutation({
    mutationFn: () => {
      const dockerImage = imageManual
        ? image.trim()
        : image.trim()
          ? `${image.trim()}:${(tag || "latest").trim()}`
          : "";
      return appsApi.create(projectId, {
        name: name.trim(),
        source_type: source,
        github_installation_id:
          source === "github" && !repoManual && installationId ? installationId : undefined,
        repo_full_name: source === "github" ? repo.trim() : undefined,
        branch: source === "github" ? branch.trim() || undefined : undefined,
        docker_image: source === "docker_image" ? dockerImage : undefined,
        port: Number(port) || 3000,
        replicas: Number(replicas) || 1,
        health_check_path: healthCheckPath.trim() || "/",
        builder: "auto",
        root_path: "/",
        auto_deploy: source === "github",
      });
    },
    onSuccess: (app) => {
      queryClient.invalidateQueries({ queryKey: ["project-apps", projectId] });
      setOpen(false);
      reset();
      router.push(`/apps/${app.id}/overview`);
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not create the app.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("App name is required.");
    if (source === "github" && !repo.trim()) {
      return setError("GitHub repository is required (e.g. owner/name).");
    }
    if (source === "docker_image" && !image.trim()) {
      return setError("Docker image is required.");
    }
    create.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="w-[min(620px,calc(100vw-2rem))]">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogEyebrow>Workloads · app</DialogEyebrow>
            <DialogTitle>Create an app</DialogTitle>
            <DialogDescription>
              Apps are containers built from source or pulled from a registry. Pick the source,
              describe the runtime, and we&rsquo;ll wire the rest at deploy time.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {error && <Alert tone="error">{error}</Alert>}

            {/* source picker */}
            <div className="space-y-2">
              <div className="label-mono">Source</div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { key: "github",       label: "GitHub repo",   icon: Github, hint: "Build on every push" },
                    { key: "docker_image", label: "Docker image",  icon: Box,    hint: "Pull a prebuilt image" },
                  ] as const
                ).map((opt) => {
                  const selected = source === opt.key;
                  const Icon = opt.icon;
                  return (
                    <button
                      type="button"
                      key={opt.key}
                      onClick={() => setSource(opt.key)}
                      className={cn(
                        "text-left rounded-[var(--radius-sm)] border p-3 transition-colors",
                        selected
                          ? "border-signal bg-[color:var(--signal-soft)]/30"
                          : "border-line-1 hover:bg-surface-2",
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="inline-flex items-center gap-2 text-[13px] text-ink-1 font-medium">
                          <Icon className="h-3.5 w-3.5" />
                          {opt.label}
                        </span>
                        {selected && <span className="h-1.5 w-1.5 rounded-full bg-signal" />}
                      </div>
                      <div className="text-[11px] text-ink-3">{opt.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <Field id="app-name" label="App name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                autoComplete="off"
                placeholder="api"
                maxLength={64}
              />
            </Field>

            {/* source-specific */}
            {source === "github" ? (
              <div className="space-y-5">
                {/* connection state — never leaves the user with a dead, empty select */}
                {noTeam ? (
                  <Alert tone="info">
                    No active team in context — enter the repository manually below.
                  </Alert>
                ) : noAppConnected ? (
                  <Alert tone="warn">
                    No GitHub App is connected for this team. Connect one in{" "}
                    <Link href="/integrations" className="underline underline-offset-2 hover:text-signal">
                      Integrations
                    </Link>
                    , then {refreshButton} — or enter the repository manually below.
                  </Alert>
                ) : installationsFailed ? (
                  <Alert tone="error">
                    Couldn’t reach GitHub to list your installations. {refreshButton} or enter the
                    repository manually below.
                  </Alert>
                ) : appButNoInstalls ? (
                  <Alert tone="warn">
                    Your GitHub App isn’t installed on any account yet. Install it on the account or
                    org that owns the repo, then {refreshButton}.
                  </Alert>
                ) : null}

                {/* GitHub App / account selector — always shown when at least one
                    installation exists, so you can deliberately pick which account
                    to browse repos from (not just when there are 2+). */}
                {hasInstalls && !repoManual && (
                  <Field
                    id="app-gh-account"
                    label="GitHub account"
                    hint="The GitHub App account or org to browse repositories from."
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <Select
                          value={installationId}
                          onValueChange={(v) => {
                            setInstallationId(v);
                            setRepo("");
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select an account" />
                          </SelectTrigger>
                          <SelectContent>
                            {installations.map((inst) => (
                              <SelectItem key={inst.id} value={inst.id}>
                                {inst.account_login}
                                <span className="text-ink-3"> · {inst.account_type}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {refreshButton}
                    </div>
                  </Field>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-5">
                  <Field
                    id="app-repo"
                    label="Repository"
                    hint={
                      repoManual || !hasInstalls
                        ? "Format: owner/repo."
                        : "Pick a repo from the selected account."
                    }
                  >
                    {!repoManual && hasInstalls ? (
                      <Combobox
                        value={repo || null}
                        onChange={(v) => {
                          setRepo(v);
                          const r = (reposQ.data ?? []).find((x) => x.full_name === v);
                          if (r?.default_branch) setBranch(r.default_branch);
                        }}
                        items={repoItems}
                        loading={reposQ.isFetching}
                        disabled={!selectedInstallation}
                        placeholder="Select a repository"
                        searchPlaceholder="Filter repositories…"
                        emptyText={
                          reposQ.isError ? "Couldn't load repositories." : "No repositories found."
                        }
                      />
                    ) : !repoManual && installationsLoading ? (
                      <Input value="" disabled placeholder="Loading GitHub accounts…" />
                    ) : (
                      <Input
                        value={repo}
                        onChange={(e) => setRepo(e.target.value)}
                        required
                        autoComplete="off"
                        placeholder="acme/api"
                      />
                    )}
                  </Field>
                  <Field id="app-branch" label="Branch">
                    <Input
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      autoComplete="off"
                      placeholder="main"
                    />
                  </Field>
                </div>

                {/* manual <-> picker toggle — only meaningful when an app is connected */}
                {hasInstalls && (
                  <div className="text-[11px] text-ink-3">
                    <button
                      type="button"
                      onClick={() => {
                        setRepoManual((m) => !m);
                        setRepo("");
                      }}
                      className="text-ink-3 hover:text-signal transition-colors underline underline-offset-2"
                    >
                      {repoManual ? "Pick from GitHub instead" : "Enter repository manually"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {imageManual ? (
                  <Field
                    id="app-image"
                    label="Docker image"
                    hint="Full reference, e.g. ghcr.io/acme/api:latest."
                  >
                    <Input
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                      required
                      autoComplete="off"
                      placeholder="ghcr.io/acme/api:latest"
                    />
                  </Field>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-5">
                    <Field id="app-image" label="Docker Hub image" hint="Search public images.">
                      <Combobox
                        value={image || null}
                        onChange={(v) => {
                          setImage(v);
                          setTag("latest");
                        }}
                        items={dockerResults}
                        onSearch={searchDocker}
                        loading={dockerLoading}
                        placeholder="Search Docker Hub…"
                        searchPlaceholder="e.g. nginx, postgres…"
                        emptyText="Type to search Docker Hub."
                      />
                    </Field>
                    <Field id="app-tag" label="Tag">
                      <Combobox
                        value={tag || null}
                        onChange={(v) => setTag(v)}
                        items={tagItems}
                        loading={tagsQ.isFetching}
                        disabled={!image}
                        placeholder="latest"
                        searchPlaceholder="Filter tags…"
                        emptyText={image ? "No tags found." : "Pick an image first."}
                      />
                    </Field>
                  </div>
                )}

                <div className="text-[11px] text-ink-3">
                  <button
                    type="button"
                    onClick={() => {
                      setImageManual((m) => !m);
                      setImage("");
                      setTag("latest");
                    }}
                    className="text-ink-3 hover:text-signal transition-colors underline underline-offset-2"
                  >
                    {imageManual
                      ? "Search Docker Hub instead"
                      : "Enter image manually (private / other registry)"}
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-5">
              <Field id="app-port" label="Port">
                <Input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  min={1}
                  max={65535}
                  autoComplete="off"
                />
              </Field>
              <Field id="app-replicas" label="Replicas">
                <Input
                  type="number"
                  value={replicas}
                  onChange={(e) => setReplicas(e.target.value)}
                  min={1}
                  max={100}
                  autoComplete="off"
                />
              </Field>
              <Field id="app-hc" label="Health path">
                <Input
                  value={healthCheckPath}
                  onChange={(e) => setHealthCheckPath(e.target.value)}
                  autoComplete="off"
                  placeholder="/"
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending}>
              Create app <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
