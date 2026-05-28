"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Github, Settings as SettingsIcon, Activity } from "lucide-react";
import { Card, CardBody, CardHeader, CardFooter } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { appsApi, ApiError } from "@/lib/api";
import type { App } from "@/lib/types";

export function AppOverview({ app }: { app: App }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState(app.name);
  const [replicas, setReplicas] = useState(String(app.replicas ?? 1));
  const [port, setPort] = useState(String(app.port ?? 3000));
  const [healthPath, setHealthPath] = useState(app.health_check_path ?? "/");
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty =
    name.trim() !== app.name ||
    Number(replicas) !== (app.replicas ?? 1) ||
    Number(port) !== (app.port ?? 3000) ||
    healthPath.trim() !== (app.health_check_path ?? "/");

  const save = useMutation({
    mutationFn: () =>
      appsApi.update(app.project_id, app.id, {
        name: name.trim(),
        replicas: Number(replicas) || 1,
        port: Number(port) || 3000,
        health_check_path: healthPath.trim() || "/",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-apps", app.project_id] });
      queryClient.invalidateQueries({ queryKey: ["app", app.id] });
      router.refresh();
    },
    onError: (err) => {
      setSaveError(err instanceof ApiError ? err.message : "Could not update the app.");
    },
  });

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    if (!name.trim()) return setSaveError("Name is required.");
    if (!dirty) return;
    save.mutate();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* runtime + identity */}
        <Card>
          <form onSubmit={handleSave}>
            <CardHeader>
              <div className="label-mono mb-1 flex items-center gap-2">
                <SettingsIcon className="h-3 w-3" /> Runtime
              </div>
              <h2 className="text-[16px] text-ink-1">Identity &amp; runtime</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              {saveError && <Alert tone="error">{saveError}</Alert>}
              {save.isSuccess && !saveError && !save.isPending && (
                <Alert tone="success">Saved.</Alert>
              )}
              <Field id="app-name" label="Name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  maxLength={64}
                />
              </Field>
              <div className="grid grid-cols-3 gap-4">
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
                <Field id="app-hp" label="Health path">
                  <Input
                    value={healthPath}
                    onChange={(e) => setHealthPath(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
              </div>
            </CardBody>
            <CardFooter>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
                {dirty ? "unsaved" : "no changes"}
              </span>
              <Button type="submit" loading={save.isPending} disabled={!dirty || !name.trim()}>
                Save changes
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* source */}
        <Card>
          <CardHeader>
            <div className="label-mono mb-1 flex items-center gap-2">
              {app.source_type === "github" ? <Github className="h-3 w-3" /> : <Box className="h-3 w-3" />}
              Source
            </div>
            <h2 className="text-[16px] text-ink-1">
              {app.source_type === "github" ? "GitHub repository" : "Docker image"}
            </h2>
          </CardHeader>
          <CardBody className="space-y-3 text-[12px]">
            {app.source_type === "github" ? (
              <>
                <Row label="Repository">
                  <span className="font-mono text-ink-1">{app.repo_full_name ?? "—"}</span>
                </Row>
                <Row label="Branch">
                  <span className="font-mono text-ink-1">{app.branch ?? "—"}</span>
                </Row>
                <Row label="Root path">
                  <span className="font-mono text-ink-1">{app.root_path ?? "/"}</span>
                </Row>
                <Row label="Builder">
                  <span className="font-mono text-ink-1">{app.builder ?? "auto"}</span>
                </Row>
                <Row label="Auto-deploy">
                  <span className="font-mono text-ink-1">{app.auto_deploy ? "on" : "off"}</span>
                </Row>
              </>
            ) : (
              <>
                <Row label="Image">
                  <span className="font-mono text-ink-1 break-all">{app.docker_image ?? "—"}</span>
                </Row>
                <Row label="Registry">
                  <span className="font-mono text-ink-1">
                    {app.registry_credential_id ? "private" : "public"}
                  </span>
                </Row>
              </>
            )}
            <div className="pt-3 border-t border-line-1">
              <div className="label-mono mb-1.5 flex items-center gap-2">
                <Activity className="h-3 w-3" /> Lifecycle
              </div>
              <Row label="Created">
                <span className="font-mono text-ink-1 num">{formatDate(app.created_at)}</span>
              </Row>
              <Row label="Updated">
                <span className="font-mono text-ink-1 num">{formatDate(app.updated_at)}</span>
              </Row>
            </div>
          </CardBody>
        </Card>
      </div>

    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="label-mono">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
