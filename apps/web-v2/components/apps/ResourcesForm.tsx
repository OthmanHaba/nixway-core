"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, MemoryStick } from "lucide-react";
import { Card, CardBody, CardHeader, CardFooter } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { appsApi, ApiError } from "@/lib/api";
import type { App } from "@/lib/types";

export function ResourcesForm({ app }: { app: App }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const initialCpu =
    app.cpu_limit_millicores ?? app.resource_cpu_millicores ?? 0;
  const initialMem = app.memory_limit_mb ?? app.resource_memory_mb ?? 0;

  const [cpu, setCpu] = useState(String(initialCpu));
  const [memory, setMemory] = useState(String(initialMem));
  const [error, setError] = useState<string | null>(null);

  const dirty = Number(cpu) !== initialCpu || Number(memory) !== initialMem;

  const save = useMutation({
    mutationFn: () =>
      appsApi.updateResources(app.id, {
        cpu_limit_millicores: Number(cpu) || 0,
        memory_limit_mb: Number(memory) || 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app", app.id] });
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not update resources.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!dirty) return;
    save.mutate();
  }

  const cpuCores = (Number(cpu) || 0) / 1000;
  const memGiB = (Number(memory) || 0) / 1024;

  return (
    <div className="space-y-6 max-w-[820px]">
      <Alert tone="info">
        Limits apply on the next deployment. <span className="text-ink-1">0</span> means no limit.
      </Alert>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <div className="label-mono mb-1">Container limits</div>
            <h2 className="text-[18px] text-ink-1">CPU &amp; memory</h2>
            <p className="mt-1 text-[13px] text-ink-3 max-w-md">
              Set ceilings for each replica. CPU is expressed in millicores —
              <span className="font-mono text-ink-2"> 1000m</span> equals one full core.
              Memory is in mebibytes.
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            {error && <Alert tone="error">{error}</Alert>}
            {save.isSuccess && !error && !save.isPending && (
              <Alert tone="success">Resource limits updated.</Alert>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <Field
                id="app-cpu"
                label={
                  <span className="inline-flex items-center gap-2">
                    <Cpu className="h-3 w-3" /> CPU (millicores)
                  </span>
                }
                hint={`= ${cpuCores.toFixed(2)} core${cpuCores === 1 ? "" : "s"}`}
              >
                <Input
                  type="number"
                  value={cpu}
                  onChange={(e) => setCpu(e.target.value)}
                  min={0}
                  step={50}
                  autoComplete="off"
                  placeholder="0"
                />
              </Field>
              <Field
                id="app-memory"
                label={
                  <span className="inline-flex items-center gap-2">
                    <MemoryStick className="h-3 w-3" /> Memory (MiB)
                  </span>
                }
                hint={`= ${memGiB.toFixed(2)} GiB`}
              >
                <Input
                  type="number"
                  value={memory}
                  onChange={(e) => setMemory(e.target.value)}
                  min={0}
                  step={64}
                  autoComplete="off"
                  placeholder="0"
                />
              </Field>
            </div>
          </CardBody>
          <CardFooter>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
              {dirty ? "unsaved" : "no changes"}
            </span>
            <Button type="submit" loading={save.isPending} disabled={!dirty}>
              Save limits
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
