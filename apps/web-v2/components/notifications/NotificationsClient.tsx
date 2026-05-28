"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AtSign,
  Bell,
  Box,
  Boxes,
  CornerDownLeft,
  Hash,
  Mail,
  MessageSquare,
  Network,
  Plus,
  Server as ServerIcon,
  Slack,
  Trash2,
  TriangleAlert,
  Webhook,
  Zap,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/primitives/Select";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { Alert } from "@/components/primitives/Alert";
import { Badge } from "@/components/primitives/Badge";
import { EmptyState } from "@/components/primitives/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/primitives/Table";
import { ConfirmDialog } from "@/components/primitives/Confirm";
import { observabilityApi, ApiError, type CreateChannelInput, type AlertRuleInput } from "@/lib/api";
import type {
  AlertEvent,
  AlertRule,
  App,
  Cluster,
  NotificationChannel,
  Project,
  Server,
} from "@/lib/types";

interface Props {
  teamId: string;
  initialChannels: NotificationChannel[];
  initialAlerts: AlertRule[];
  initialEvents: AlertEvent[];
  servers: Server[];
  clusters: Cluster[];
  projects: Project[];
  apps: App[];
}

const CHANNEL_TYPES: Array<{ value: string; label: string; icon: ReactNode; hint: string }> = [
  { value: "slack",   label: "Slack",   icon: <Slack className="h-3 w-3" />,    hint: "Incoming webhook URL (https://hooks.slack.com/…)" },
  { value: "webhook", label: "Webhook", icon: <Webhook className="h-3 w-3" />,  hint: "Generic POST endpoint — receives JSON payloads." },
  { value: "discord", label: "Discord", icon: <MessageSquare className="h-3 w-3" />, hint: "Discord webhook URL (https://discord.com/api/webhooks/…)" },
  { value: "email",   label: "Email",   icon: <Mail className="h-3 w-3" />,     hint: "Single email address." },
];

const COMPARISONS = [
  { value: "gt",  label: ">"  },
  { value: "gte", label: ">=" },
  { value: "lt",  label: "<"  },
  { value: "lte", label: "<=" },
  { value: "eq",  label: "==" },
  { value: "ne",  label: "!=" },
];

const SEVERITIES = ["info", "warning", "critical"];

const SCOPE_TYPES: Array<{ value: string; label: string; icon: ReactNode }> = [
  { value: "server",  label: "Server",  icon: <ServerIcon className="h-3 w-3" /> },
  { value: "cluster", label: "Cluster", icon: <Network    className="h-3 w-3" /> },
  { value: "project", label: "Project", icon: <Box        className="h-3 w-3" /> },
  { value: "app",     label: "App",     icon: <Boxes      className="h-3 w-3" /> },
];

export function NotificationsClient({
  teamId,
  initialChannels,
  initialAlerts,
  initialEvents,
  servers,
  clusters,
  projects,
  apps,
}: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const channels = useQuery({
    queryKey: ["channels", teamId],
    queryFn: () => observabilityApi.listChannels(teamId),
    initialData: initialChannels,
  });
  const alerts = useQuery({
    queryKey: ["alerts", teamId],
    queryFn: () => observabilityApi.listAlerts(teamId),
    initialData: initialAlerts,
    refetchInterval: 30_000,
  });
  const events = useQuery({
    queryKey: ["alert-events", teamId],
    queryFn: () => observabilityApi.listEvents(teamId, { limit: 50 }),
    initialData: initialEvents,
    refetchInterval: 30_000,
  });

  const evaluate = useMutation({
    mutationFn: () => observabilityApi.evaluateAlerts(teamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts", teamId] });
      queryClient.invalidateQueries({ queryKey: ["alert-events", teamId] });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Evaluation failed."),
  });
  const removeAlert = useMutation({
    mutationFn: (id: string) => observabilityApi.deleteAlert(teamId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts", teamId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not delete."),
  });

  const channelById = useMemo(
    () => new Map((channels.data ?? []).map((c) => [c.id, c])),
    [channels.data],
  );
  const scopeLabel = useMemo(
    () =>
      scopeLabeller({
        server: new Map(servers.map((s) => [s.id, s.name])),
        cluster: new Map(clusters.map((c) => [c.id, c.name])),
        project: new Map(projects.map((p) => [p.id, p.name])),
        app: new Map(apps.map((a) => [a.id, a.name])),
      }),
    [servers, clusters, projects, apps],
  );

  return (
    <div className="space-y-8 max-w-[1080px]">
      {error && <Alert tone="error">{error}</Alert>}

      {/* Channels */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="label-mono mb-1 inline-flex items-center gap-2">
              <Bell className="h-3 w-3" /> Outbound
            </div>
            <h2 className="text-[18px] text-ink-1">Notification channels</h2>
            <p className="mt-1 text-[12px] text-ink-3 max-w-md">
              Destinations the platform delivers alerts to. Channels are
              referenced from individual alert rules.
            </p>
          </div>
          <CreateChannelDialog
            teamId={teamId}
            trigger={
              <Button>
                <Plus className="h-3.5 w-3.5" /> New channel
              </Button>
            }
          />
        </div>
        {(channels.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Bell className="h-4 w-4" />}
            title="No channels yet"
            body="Add a Slack, Discord, webhook or email channel to start receiving alerts."
          />
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Type</TH>
                  <TH>Target</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <TBody>
                {channels.data!.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <span className="inline-flex items-center gap-2">
                        {channelTypeIcon(c.type)}
                        <span className="font-mono text-[12px] text-ink-1">{c.name}</span>
                      </span>
                    </TD>
                    <TD>
                      <Badge tone="outline">{c.type}</Badge>
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3 truncate max-w-[260px] block">
                        {maskTarget(c.target)}
                      </span>
                    </TD>
                    <TD>
                      {c.enabled ? (
                        <Badge tone="online" dot>
                          on
                        </Badge>
                      ) : (
                        <Badge tone="neutral">off</Badge>
                      )}
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3 num">
                        {formatDate(c.created_at)}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>

      {/* Alert rules */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="label-mono mb-1 inline-flex items-center gap-2">
              <Zap className="h-3 w-3" /> Triggers
            </div>
            <h2 className="text-[18px] text-ink-1">Alert rules</h2>
            <p className="mt-1 text-[12px] text-ink-3 max-w-md">
              Fire a notification when a metric on a specific resource crosses
              its threshold for a sustained duration.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => evaluate.mutate()}
              loading={evaluate.isPending}
              disabled={(alerts.data?.length ?? 0) === 0}
            >
              <Zap className="h-3.5 w-3.5" /> Evaluate now
            </Button>
            <CreateAlertDialog
              teamId={teamId}
              channels={channels.data ?? []}
              servers={servers}
              clusters={clusters}
              projects={projects}
              apps={apps}
              trigger={
                <Button disabled={(channels.data?.length ?? 0) === 0}>
                  <Plus className="h-3.5 w-3.5" /> New rule
                </Button>
              }
            />
          </div>
        </div>
        {(alerts.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Zap className="h-4 w-4" />}
            title="No alert rules yet"
            body={
              (channels.data?.length ?? 0) === 0
                ? "Add a channel first, then attach an alert rule to start getting paged when metrics drift."
                : "Create a rule to fire when CPU, memory or another metric crosses a threshold for a sustained window."
            }
          />
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Rule</TH>
                  <TH>Scope</TH>
                  <TH>Condition</TH>
                  <TH>Severity</TH>
                  <TH>Channels</TH>
                  <TH>State</TH>
                  <TH align="right" className="w-12"> </TH>
                </TR>
              </THead>
              <TBody>
                {alerts.data!.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <div className="flex items-center gap-2">
                        {r.enabled ? (
                          <Badge tone="online" dot>
                            on
                          </Badge>
                        ) : (
                          <Badge tone="neutral">off</Badge>
                        )}
                        <span className="font-mono text-[12px] text-ink-1">{r.name}</span>
                      </div>
                    </TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5">
                        <Hash className="h-3 w-3 text-ink-3" />
                        <span className="font-mono text-[11px] text-ink-2">
                          {r.scope_type}/{scopeLabel(r.scope_type, r.scope_id)}
                        </span>
                      </span>
                    </TD>
                    <TD>
                      <span className="font-mono text-[12px] text-ink-1">
                        {r.metric_name}
                      </span>
                      <span className="font-mono text-[11px] text-ink-3 ml-1">
                        {comparisonSymbol(r.comparison)} {formatNumber(r.threshold)}
                      </span>
                      <div className="font-mono text-[10px] text-ink-4 num">
                        for {r.duration_seconds}s
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1 max-w-[180px]">
                        {r.notification_channels.length === 0 && (
                          <span className="font-mono text-[10px] text-ink-4">none</span>
                        )}
                        {r.notification_channels.slice(0, 3).map((cid) => {
                          const ch = channelById.get(cid);
                          return (
                            <span
                              key={cid}
                              className="font-mono text-[10px] text-ink-2 border border-line-1 rounded px-1.5 py-0.5"
                              title={ch?.target}
                            >
                              {ch?.name ?? cid.slice(0, 6)}
                            </span>
                          );
                        })}
                        {r.notification_channels.length > 3 && (
                          <span className="font-mono text-[10px] text-ink-4">
                            +{r.notification_channels.length - 3}
                          </span>
                        )}
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={stateTone(r.last_state)}>
                        {r.last_state || "—"}
                      </Badge>
                      {r.last_value != null && (
                        <div className="font-mono text-[10px] text-ink-4 num mt-0.5">
                          val {formatNumber(r.last_value)}
                        </div>
                      )}
                    </TD>
                    <TD align="right">
                      <ConfirmDialog
                        destructive
                        title="Delete this alert rule?"
                        description={
                          <>
                            Removes <span className="text-ink-1">{r.name}</span> and stops
                            future evaluations. Past events stay in the audit table.
                          </>
                        }
                        confirmLabel="Delete rule"
                        onConfirm={() =>
                          new Promise<void>((resolve, reject) =>
                            removeAlert.mutate(r.id, {
                              onSuccess: () => resolve(),
                              onError: (e) => reject(e),
                            }),
                          )
                        }
                        trigger={
                          <button
                            type="button"
                            aria-label="Delete rule"
                            className="h-7 w-7 grid place-items-center rounded-[var(--radius-sm)] text-ink-3 hover:text-alert hover:bg-surface-2 transition-colors"
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
      </section>

      {/* Events */}
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <div className="label-mono mb-1 inline-flex items-center gap-2">
              <Activity className="h-3 w-3" /> Audit
            </div>
            <h2 className="text-[18px] text-ink-1">Recent alert events</h2>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
            {events.data?.length ?? 0}
          </span>
        </div>
        {(events.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<TriangleAlert className="h-4 w-4" />}
            title="No alert events yet"
            body="State transitions on alert rules will show up here once the evaluator fires."
          />
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-line-1 bg-surface-1 overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>State</TH>
                  <TH>Scope</TH>
                  <TH>Threshold</TH>
                  <TH>Value</TH>
                  <TH>Message</TH>
                </TR>
              </THead>
              <TBody>
                {events.data!.map((ev) => (
                  <TR key={ev.id}>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-3 num">
                        {formatWhen(ev.created_at)}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={stateTone(ev.state)}>{ev.state}</Badge>
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-2">
                        {ev.scope_type}/{scopeLabel(ev.scope_type, ev.scope_id)}
                      </span>
                    </TD>
                    <TD>
                      <span className="font-mono text-[11px] text-ink-1 num">
                        {formatNumber(ev.threshold)}
                      </span>
                    </TD>
                    <TD>
                      <span className="font-mono text-[12px] text-ink-1 num">
                        {ev.metric_value != null ? formatNumber(ev.metric_value) : "—"}
                      </span>
                    </TD>
                    <TD>
                      <span className="text-[12px] text-ink-3 truncate block max-w-[420px]">
                        {ev.message || "—"}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function CreateChannelDialog({
  teamId,
  trigger,
}: {
  teamId: string;
  trigger: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("slack");
  const [target, setTarget] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setType("slack");
    setTarget("");
    setEnabled(true);
    setError(null);
  }

  const create = useMutation({
    mutationFn: () => {
      const input: CreateChannelInput = {
        name: name.trim(),
        type,
        target: target.trim(),
        enabled,
      };
      return observabilityApi.createChannel(teamId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels", teamId] });
      setOpen(false);
      reset();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not create channel."),
  });

  const hint = CHANNEL_TYPES.find((c) => c.value === type)?.hint;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>Observability · channel</DialogEyebrow>
          <DialogTitle>Add a notification channel</DialogTitle>
          <DialogDescription>
            Channels are reusable across alert rules. Webhook payloads include the rule,
            scope, metric, threshold and value.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field id="ch-name" label="Name" hint="Used on the alert rule UI.">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              placeholder="oncall-pager"
              maxLength={120}
            />
          </Field>
          <div className="space-y-2">
            <div className="label-mono">Type</div>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="inline-flex items-center gap-2">
                      {t.icon}
                      <span className="font-mono text-[12px]">{t.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field
            id="ch-target"
            label={type === "email" ? "Email" : "Webhook URL"}
            hint={hint}
          >
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              autoComplete="off"
              placeholder={type === "email" ? "team@example.com" : "https://…"}
              maxLength={500}
            />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 accent-[color:var(--signal)]"
            />
            <span className="font-mono text-[12px] text-ink-2">
              Enable this channel immediately
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
            disabled={!name.trim() || !target.trim()}
          >
            <Plus className="h-3.5 w-3.5" /> Add channel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateAlertDialog({
  teamId,
  channels,
  servers,
  clusters,
  projects,
  apps,
  trigger,
}: {
  teamId: string;
  channels: NotificationChannel[];
  servers: Server[];
  clusters: Cluster[];
  projects: Project[];
  apps: App[];
  trigger: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scopeType, setScopeType] = useState<string>("server");
  const [scopeId, setScopeId] = useState<string>("");
  const [name, setName] = useState("");
  const [metric, setMetric] = useState("cpu_percent");
  const [comparison, setComparison] = useState("gt");
  const [threshold, setThreshold] = useState("80");
  const [duration, setDuration] = useState("120");
  const [severity, setSeverity] = useState("warning");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const scopeChoices = scopeType === "server" ? servers
                     : scopeType === "cluster" ? clusters
                     : scopeType === "project" ? projects
                     : apps;

  function reset() {
    setScopeType("server");
    setScopeId("");
    setName("");
    setMetric("cpu_percent");
    setComparison("gt");
    setThreshold("80");
    setDuration("120");
    setSeverity("warning");
    setPicked([]);
    setError(null);
  }

  const create = useMutation({
    mutationFn: () => {
      const input: AlertRuleInput = {
        scope_type: scopeType,
        scope_id: scopeId,
        name: name.trim(),
        metric_name: metric,
        comparison,
        threshold: Number(threshold) || 0,
        duration_seconds: Number(duration) || 0,
        severity,
        enabled: true,
        notification_channels: picked,
      };
      return observabilityApi.createAlert(teamId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts", teamId] });
      setOpen(false);
      reset();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not create alert."),
  });

  function toggleChannel(id: string) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
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
      <DialogContent className="max-w-[680px]">
        <DialogHeader>
          <DialogEyebrow>Observability · alert</DialogEyebrow>
          <DialogTitle>New alert rule</DialogTitle>
          <DialogDescription>
            Watches a metric on a specific resource. When the threshold holds for the
            configured window, every selected channel receives a notification.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}
          <Field id="al-name" label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              placeholder="server-cpu-high"
              maxLength={120}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="label-mono">Scope</div>
              <Select
                value={scopeType}
                onValueChange={(v) => {
                  setScopeType(v);
                  setScopeId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_TYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      <span className="inline-flex items-center gap-2">
                        {s.icon}
                        <span className="font-mono text-[12px]">{s.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="label-mono">Resource</div>
              <Select value={scopeId} onValueChange={setScopeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a resource" />
                </SelectTrigger>
                <SelectContent>
                  {scopeChoices.length === 0 ? (
                    <SelectItem disabled value="__none__">
                      <span className="font-mono text-[11px] text-ink-4">no {scopeType}s in this team</span>
                    </SelectItem>
                  ) : (
                    scopeChoices.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="font-mono text-[12px]">{s.name}</span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-3">
            <Field id="al-metric" label="Metric">
              <Input
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                autoComplete="off"
                placeholder="cpu_percent"
                maxLength={120}
              />
            </Field>
            <div className="space-y-2">
              <div className="label-mono">Comparison</div>
              <Select value={comparison} onValueChange={setComparison}>
                <SelectTrigger>
                  <SelectValue placeholder="op" />
                </SelectTrigger>
                <SelectContent>
                  {COMPARISONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      <span className="font-mono text-[13px]">{c.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field id="al-threshold" label="Threshold">
              <Input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                step="any"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field id="al-duration" label="Duration (s)" hint="Sustained window before firing.">
              <Input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                min={1}
                step={10}
              />
            </Field>
            <div className="space-y-2">
              <div className="label-mono">Severity</div>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue placeholder="severity" />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className="font-mono text-[12px]">{s}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="label-mono">Notify via</div>
            {channels.length === 0 ? (
              <p className="text-[12px] text-ink-3">No channels yet — add one first.</p>
            ) : (
              <ul className="rounded-[var(--radius-md)] border border-line-1 divide-y divide-line-1 bg-surface-1 overflow-hidden max-h-[180px] overflow-y-auto">
                {channels.map((c) => {
                  const checked = picked.includes(c.id);
                  return (
                    <li key={c.id}>
                      <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-2 transition-colors">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleChannel(c.id)}
                          className="h-3.5 w-3.5 accent-[color:var(--signal)]"
                        />
                        {channelTypeIcon(c.type)}
                        <span className="font-mono text-[12px] text-ink-1">{c.name}</span>
                        <span className="font-mono text-[10px] text-ink-4 ml-auto">{c.type}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
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
            disabled={!name.trim() || !scopeId || !threshold || !duration}
          >
            <CornerDownLeft className="h-3.5 w-3.5" /> Create rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function channelTypeIcon(type: string): ReactNode {
  switch (type) {
    case "slack":   return <Slack className="h-3 w-3 text-ink-3" />;
    case "webhook": return <Webhook className="h-3 w-3 text-ink-3" />;
    case "discord": return <MessageSquare className="h-3 w-3 text-ink-3" />;
    case "email":   return <AtSign className="h-3 w-3 text-ink-3" />;
    default:        return <Bell className="h-3 w-3 text-ink-3" />;
  }
}

function maskTarget(target: string): string {
  // Hide auth tokens in webhook URLs for at-a-glance comfort. Show the host
  // and a few trailing chars so it's still identifiable.
  if (target.length <= 40) return target;
  try {
    const u = new URL(target);
    const tail = u.pathname.slice(-6);
    return `${u.host}/…${tail}`;
  } catch {
    return target.slice(0, 12) + "…" + target.slice(-6);
  }
}

function scopeLabeller(maps: {
  server: Map<string, string>;
  cluster: Map<string, string>;
  project: Map<string, string>;
  app: Map<string, string>;
}) {
  return (type: string, id: string): string => {
    const m = (maps as Record<string, Map<string, string>>)[type];
    return m?.get(id) ?? id.slice(0, 8);
  };
}

function severityTone(s: string): "info" | "warn" | "alert" | "neutral" {
  switch (s) {
    case "critical": return "alert";
    case "warning":  return "warn";
    case "info":     return "info";
    default:         return "neutral";
  }
}

function stateTone(s: string): "online" | "warn" | "alert" | "neutral" | "signal" {
  switch (s) {
    case "ok":      return "online";
    case "pending": return "signal";
    case "firing":  return "alert";
    default:        return "neutral";
  }
}

function comparisonSymbol(c: string): string {
  return COMPARISONS.find((o) => o.value === c)?.label ?? c;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16);
}
