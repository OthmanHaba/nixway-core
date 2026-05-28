"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Github, Box } from "lucide-react";
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
import { appsApi, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

type Source = "github" | "docker_image";

export function CreateAppDialog({
  projectId,
  trigger,
}: {
  projectId: string;
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

  // Docker
  const [image, setImage] = useState("");

  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSource("github");
    setName("");
    setPort("3000");
    setReplicas("1");
    setHealthCheckPath("/");
    setRepo("");
    setBranch("main");
    setImage("");
    setError(null);
  }

  const create = useMutation({
    mutationFn: () =>
      appsApi.create(projectId, {
        name: name.trim(),
        source_type: source,
        repo_full_name: source === "github" ? repo.trim() : undefined,
        branch: source === "github" ? (branch.trim() || undefined) : undefined,
        docker_image: source === "docker_image" ? image.trim() : undefined,
        port: Number(port) || 3000,
        replicas: Number(replicas) || 1,
        health_check_path: healthCheckPath.trim() || "/",
        builder: "auto",
        root_path: "/",
        auto_deploy: source === "github",
      }),
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
      return setError("Docker image reference is required.");
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
              <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-5">
                <Field
                  id="app-repo"
                  label="Repository"
                  hint="Format: owner/repo. We use the team's GitHub installation."
                >
                  <Input
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    required
                    autoComplete="off"
                    placeholder="acme/api"
                  />
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
            ) : (
              <Field
                id="app-image"
                label="Docker image"
                hint="Full reference, e.g. ghcr.io/acme/api:latest. Use the Registries page for private images."
              >
                <Input
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  required
                  autoComplete="off"
                  placeholder="ghcr.io/acme/api:latest"
                />
              </Field>
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
