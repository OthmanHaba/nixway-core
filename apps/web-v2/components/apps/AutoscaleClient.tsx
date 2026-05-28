"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ChevronsUpDown,
  Cpu,
  Gauge,
  Plus,
  Power,
  Trash2,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogEyebrow,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/primitives/Dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/primitives/Select";
import { Card, CardBody, CardHeader } from "@/components/primitives/Card";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { Badge } from "@/components/primitives/Badge";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/primitives/Table";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { appsApi, ApiError, type CreateAutoscalingRuleInput } from "@/lib/api";
import type { App, AutoscaleEvaluation, AutoscalingRule } from "@/lib/types";

const METRIC_OPTIONS: Array<{ value: string; label: string; unit: string }> = [
  { value: "cpu_percent",      label: "CPU utilisation",  unit: "%" },
  { value: "memory_percent",   label: "Memory utilisation", unit: "%" },
  { value: "request_rate",     label: "Request rate",     unit: "req/s" },
  { value: "p95_latency_ms",   label: "P95 latency",      unit: "ms" },
  { value: "error_rate",       label: "Error rate",       unit: "%" },
];

const COMPARISON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "gt",  label: ">"  },
  { value: "gte", label: ">=" },
  { value: "lt",  label: "<"  },
  { value: "lte", label: "<=" },
  { value: "eq",  label: "==" },
  { value: "ne",  label: "!=" },
];

const ACTION_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "scale_by", label: "Scale by", hint: "Add (or subtract) this many replicas." },
  { value: "scale_to", label: "Scale to", hint: "Set replicas to this exact number." },
];

interface Props {
  app: App;
  initialRules: AutoscalingRule[];
}

export function AutoscaleClient({ app, initialRules }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [evaluations, setEvaluations] = useState<AutoscaleEvaluation[] | null>(null);

  const rules = useQuery({
    queryKey: ["autoscaling-rules", app.id],
    queryFn: () => appsApi.listAutoscalingRules(app.id),
    initialData: initialRules,
  });

  const remove = useMutation({
    mutationFn: (ruleId: string) => appsApi.deleteAutoscalingRule(app.id, ruleId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["autoscaling-rules", app.id] }),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not delete rule."),
  });

  const evaluate = useMutation({
    mutationFn: () => appsApi.evaluateAutoscaling(app.id),
    onSuccess: (res) => {
      setError(null);
      setEvaluations(res);
      queryClient.invalidateQueries({ queryKey: ["autoscaling-rules", app.id] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Evaluation failed."),
  });

  const list = rules.data ?? [];

  return (
    <div className="space-y-6 max-w-[960px]">
      <Alert tone="info">
        Autoscaling rules watch a metric over a sustained window and adjust the
        replica count — bounded by min/max — when the threshold is crossed. Use
        cooldowns to avoid flapping during noisy traffic.
      </Alert>

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="label-mono mb-1">Rules</div>
          <h2 className="text-[18px] text-ink-1">Declarative scale triggers</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => evaluate.mutate()}
            loading={evaluate.isPending}
            disabled={list.length === 0}
          >
            <Zap className="h-3.5 w-3.5" /> Evaluate now
          </Button>
          <CreateRuleDialog
            appId={app.id}
            trigger={
              <Button>
                <Plus className="h-3.5 w-3.5" /> New rule
              </Button>
            }
          />
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {list.length === 0 ? (
        <EmptyState
          icon={<Gauge className="h-4 w-4" />}
          title="No autoscaling rules yet"
          body="Add a rule to react to CPU, memory or request-rate spikes automatically."
          action={
            <CreateRuleDialog
              appId={app.id}
              trigger={
                <Button>
                  <Plus className="h-3.5 w-3.5" /> Add first rule
                </Button>
              }
            />
          }
        />
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Rule</TH>
                <TH>Condition</TH>
                <TH>Action</TH>
                <TH>Bounds</TH>
                <TH>Cooldowns</TH>
                <TH>Last fired</TH>
                <TH align="right" className="w-12"> </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      {r.enabled ? (
                        <Badge tone="online" dot>
                          On
                        </Badge>
                      ) : (
                        <Badge tone="neutral">
                          <Power className="h-2.5 w-2.5" /> Off
                        </Badge>
                      )}
                      <span className="font-mono text-[12px] text-ink-1">{r.name}</span>
                    </div>
                  </TD>
                  <TD>
                    <span className="font-mono text-[12px] text-ink-1">
                      {prettyMetric(r.metric_name)}
                    </span>
                    <span className="font-mono text-[11px] text-ink-3 ml-1">
                      {comparisonSymbol(r.comparison)} {fmtNumber(r.threshold)}
                      {metricUnit(r.metric_name)}
                    </span>
                    <div className="font-mono text-[10px] text-ink-4 num">
                      for {r.duration_seconds}s
                    </div>
                  </TD>
                  <TD>
                    <span className="font-mono text-[12px] text-ink-1 inline-flex items-center gap-1.5">
                      <ChevronsUpDown className="h-3 w-3 text-ink-3" />
                      {actionLabel(r.action_type, r.action_value)}
                    </span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-2 num">
                      {r.min_replicas}–{r.max_replicas}
                    </span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[10px] text-ink-3 num">
                      ↑{r.cooldown_up_seconds}s · ↓{r.cooldown_down_seconds}s
                    </span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11px] text-ink-3 num">
                      {r.last_triggered_at ? formatWhen(r.last_triggered_at) : "—"}
                    </span>
                  </TD>
                  <TD align="right">
                    <ConfirmDialog
                      destructive
                      title="Delete this autoscaling rule?"
                      description={
                        <>
                          Removes <span className="text-ink-1">{r.name}</span>. The app keeps
                          its current replica count — only future automatic adjustments stop.
                        </>
                      }
                      confirmLabel="Delete rule"
                      onConfirm={() =>
                        new Promise<void>((resolve, reject) =>
                          remove.mutate(r.id, {
                            onSuccess: () => resolve(),
                            onError: (e) => reject(e),
                          }),
                        )
                      }
                      trigger={
                        <button
                          type="button"
                          className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-alert hover:bg-surface-2 transition-colors"
                          aria-label="Delete rule"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      }
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      {evaluations && (
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <div className="label-mono mb-1">Last evaluation</div>
              <h2 className="text-[18px] text-ink-1">Metric readings</h2>
            </div>
            <button
              type="button"
              onClick={() => setEvaluations(null)}
              className="font-mono uppercase tracking-[0.14em] text-[10px] text-ink-3 hover:text-ink-1"
            >
              Dismiss
            </button>
          </div>
          {evaluations.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-4 w-4" />}
              title="Nothing to evaluate"
              body="Rules need to be present and enabled before an evaluation produces results."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {evaluations.map((ev) => (
                <Card key={ev.rule_id}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="label-mono">{prettyMetric(ev.metric_name)}</div>
                        <div className="font-mono text-[13px] text-ink-1 truncate">
                          {ev.rule_name}
                        </div>
                      </div>
                      {ev.triggered ? (
                        <Badge tone="signal">Triggered</Badge>
                      ) : (
                        <Badge tone="neutral">Idle</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardBody className="space-y-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[26px] text-ink-1 num">
                        {fmtNumber(ev.metric_value)}
                      </span>
                      <span className="font-mono text-[12px] text-ink-3">
                        {metricUnit(ev.metric_name) || ""}
                      </span>
                    </div>
                    <p className="text-[12px] text-ink-3 leading-relaxed">{ev.message || "—"}</p>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function CreateRuleDialog({
  appId,
  trigger,
}: {
  appId: string;
  trigger: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("CPU autoscale");
  const [metric, setMetric] = useState("cpu_percent");
  const [comparison, setComparison] = useState("gt");
  const [threshold, setThreshold] = useState("70");
  const [duration, setDuration] = useState("120");
  const [action, setAction] = useState("scale_by");
  const [actionValue, setActionValue] = useState("1");
  const [minReplicas, setMinReplicas] = useState("1");
  const [maxReplicas, setMaxReplicas] = useState("10");
  const [cooldownUp, setCooldownUp] = useState("60");
  const [cooldownDown, setCooldownDown] = useState("300");
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("CPU autoscale");
    setMetric("cpu_percent");
    setComparison("gt");
    setThreshold("70");
    setDuration("120");
    setAction("scale_by");
    setActionValue("1");
    setMinReplicas("1");
    setMaxReplicas("10");
    setCooldownUp("60");
    setCooldownDown("300");
    setEnabled(true);
    setError(null);
  }

  const create = useMutation({
    mutationFn: () => {
      const input: CreateAutoscalingRuleInput = {
        name: name.trim() || undefined,
        metric_name: metric,
        comparison,
        threshold: Number(threshold) || 0,
        duration_seconds: Number(duration) || 0,
        action_type: action,
        action_value: Number(actionValue) || 0,
        min_replicas: Number(minReplicas) || 0,
        max_replicas: Number(maxReplicas) || 0,
        cooldown_up_seconds: Number(cooldownUp) || 0,
        cooldown_down_seconds: Number(cooldownDown) || 0,
        enabled,
      };
      return appsApi.createAutoscalingRule(appId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autoscaling-rules", appId] });
      setOpen(false);
      reset();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not create rule."),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogEyebrow>Autoscaling · rule</DialogEyebrow>
          <DialogTitle>New rule</DialogTitle>
          <DialogDescription>
            Fire an action when a metric stays past its threshold for the configured window.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}

          <Field id="rule-name" label="Name" hint="Used in scaling events for context.">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              placeholder="CPU autoscale"
              maxLength={120}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-3">
            <div className="space-y-1.5">
              <div className="label-mono">Metric</div>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger>
                  <SelectValue placeholder="Metric" />
                </SelectTrigger>
                <SelectContent>
                  {METRIC_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <span className="inline-flex items-center gap-2">
                        <Cpu className="h-3 w-3 text-ink-3" />
                        <span className="font-mono text-[12px]">{m.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="label-mono">Comparison</div>
              <Select value={comparison} onValueChange={setComparison}>
                <SelectTrigger>
                  <SelectValue placeholder="op" />
                </SelectTrigger>
                <SelectContent>
                  {COMPARISON_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      <span className="font-mono text-[13px]">{c.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field
              id="rule-threshold"
              label="Threshold"
              hint={metricUnit(metric) || ""}
            >
              <Input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                min={0}
                step="any"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="rule-duration" label="Duration (seconds)" hint="Sustained window before the action fires.">
              <Input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                min={1}
                step={10}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="label-mono">Action</div>
                <Select value={action} onValueChange={setAction}>
                  <SelectTrigger>
                    <SelectValue placeholder="action" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_OPTIONS.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        <span className="font-mono text-[12px]">{a.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Field
                id="rule-action-value"
                label="Value"
                hint={ACTION_OPTIONS.find((a) => a.value === action)?.hint}
              >
                <Input
                  type="number"
                  value={actionValue}
                  onChange={(e) => setActionValue(e.target.value)}
                  step={1}
                />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field id="rule-min" label="Min replicas">
              <Input
                type="number"
                value={minReplicas}
                onChange={(e) => setMinReplicas(e.target.value)}
                min={1}
                step={1}
              />
            </Field>
            <Field id="rule-max" label="Max replicas">
              <Input
                type="number"
                value={maxReplicas}
                onChange={(e) => setMaxReplicas(e.target.value)}
                min={1}
                step={1}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              id="rule-cd-up"
              label="Scale-up cooldown (s)"
              hint="Wait this long after scaling up before triggering again."
            >
              <Input
                type="number"
                value={cooldownUp}
                onChange={(e) => setCooldownUp(e.target.value)}
                min={0}
                step={10}
              />
            </Field>
            <Field
              id="rule-cd-down"
              label="Scale-down cooldown (s)"
              hint="Be slower to give back — defaults to 5 minutes."
            >
              <Input
                type="number"
                value={cooldownDown}
                onChange={(e) => setCooldownDown(e.target.value)}
                min={0}
                step={10}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 accent-[color:var(--signal)]"
            />
            <span className="font-mono text-[12px] text-ink-2">
              Enable this rule immediately
            </span>
          </label>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!threshold || !duration}
          >
            <Plus className="h-3.5 w-3.5" /> Add rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function prettyMetric(name: string): string {
  return METRIC_OPTIONS.find((m) => m.value === name)?.label ?? name;
}

function metricUnit(name: string): string {
  return METRIC_OPTIONS.find((m) => m.value === name)?.unit ?? "";
}

function comparisonSymbol(c: string): string {
  return COMPARISON_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

function actionLabel(type: string, value: number): string {
  switch (type) {
    case "scale_by":
      return `${value >= 0 ? "+" : ""}${value} replica${Math.abs(value) === 1 ? "" : "s"}`;
    case "scale_to":
      return `set to ${value}`;
    default:
      return `${type}(${value})`;
  }
}

function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16);
}
