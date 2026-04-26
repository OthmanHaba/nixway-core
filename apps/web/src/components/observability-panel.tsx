import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import type { AlertEvent, AlertRule, MetricSample } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function formatMetricValue(value: number, metric: string): string {
  if (metric.includes('bytes')) {
    if (value === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
    return `${(value / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
  }
  if (metric.includes('percent')) return `${value.toFixed(1)}%`
  if (metric.includes('seconds')) return `${Math.round(value)}s`
  return value.toFixed(2)
}

function stateVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'firing') return 'destructive'
  if (state === 'pending') return 'secondary'
  if (state === 'resolved') return 'outline'
  return 'default'
}

function MetricChart({ samples, metric }: { samples: MetricSample[]; metric: string }) {
  const values = samples.map((sample) => sample.value)
  const latest = values.at(-1) ?? 0
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 100
  const span = Math.max(1, max - min)
  const points = samples.map((sample, index) => {
    const x = samples.length <= 1 ? 0 : (index / (samples.length - 1)) * 100
    const y = 40 - ((sample.value - min) / span) * 34 - 3
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-3 text-sm">
          <span>{metric}</span>
          <span className="font-mono text-base">{formatMetricValue(latest, metric)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-28">
          {samples.length < 2 ? (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
              Waiting for samples
            </div>
          ) : (
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full overflow-visible">
              <polyline
                fill="none"
                stroke="rgb(37 99 235)"
                strokeWidth="1.8"
                vectorEffect="non-scaling-stroke"
                points={points}
              />
            </svg>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function MetricChartQuery({
  teamId,
  scopeType,
  scopeId,
  metric,
  range,
}: {
  teamId: string
  scopeType: string
  scopeId: string
  metric: string
  range: string
}) {
  const { data = [] } = useQuery({
    queryKey: ['observability', teamId, scopeType, scopeId, metric, range],
    queryFn: () => api.get<MetricSample[]>(`/teams/${teamId}/observability/metrics?scope_type=${scopeType}&scope_id=${scopeId}&metric=${metric}&range=${range}&limit=800`),
    refetchInterval: 15_000,
  })
  return <MetricChart metric={metric} samples={data} />
}

export function ObservabilityPanel({
  teamId,
  scopeType,
  scopeId,
  metrics,
}: {
  teamId: string
  scopeType: string
  scopeId: string
  metrics: string[]
}) {
  const [range, setRange] = useState('1h')
  const queryClient = useQueryClient()
  const [alertDraft, setAlertDraft] = useState({
    name: 'High usage',
    metric_name: metrics[0] ?? '',
    comparison: 'gt',
    threshold: 90,
    duration_seconds: 300,
    severity: 'warning',
  })

  const { data: alerts = [] } = useQuery({
    queryKey: ['observability', teamId, scopeType, scopeId, 'alerts'],
    queryFn: () => api.get<AlertRule[]>(`/teams/${teamId}/observability/alerts?scope_type=${scopeType}&scope_id=${scopeId}`),
    refetchInterval: 15_000,
  })

  const { data: events = [] } = useQuery({
    queryKey: ['observability', teamId, scopeType, scopeId, 'events'],
    queryFn: () => api.get<AlertEvent[]>(`/teams/${teamId}/observability/events?scope_type=${scopeType}&scope_id=${scopeId}&limit=20`),
    refetchInterval: 15_000,
  })

  const createAlert = useMutation({
    mutationFn: () => api.post<AlertRule>(`/teams/${teamId}/observability/alerts`, {
      scope_type: scopeType,
      scope_id: scopeId,
      ...alertDraft,
      enabled: true,
      notification_channels: [],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['observability', teamId, scopeType, scopeId, 'alerts'] })
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Activity className="h-4 w-4" />
          15s realtime refresh with historical range
        </div>
        <select
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={range}
          onChange={(event) => setRange(event.target.value)}
        >
          <option value="5m">5m</option>
          <option value="1h">1h</option>
          <option value="24h">24h</option>
          <option value="7d">7d</option>
          <option value="30d">30d</option>
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {metrics.map((metric) => (
          <MetricChartQuery
            key={metric}
            teamId={teamId}
            scopeType={scopeType}
            scopeId={scopeId}
            metric={metric}
            range={range}
          />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Alert Rules</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form
              className="grid gap-3 lg:grid-cols-[1fr_1fr_90px_110px_auto]"
              onSubmit={(event) => {
                event.preventDefault()
                createAlert.mutate()
              }}
            >
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={alertDraft.name}
                  onChange={(event) => setAlertDraft((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Metric</Label>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={alertDraft.metric_name}
                  onChange={(event) => setAlertDraft((prev) => ({ ...prev, metric_name: event.target.value }))}
                >
                  {metrics.map((metric) => <option key={metric} value={metric}>{metric}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Op</Label>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={alertDraft.comparison}
                  onChange={(event) => setAlertDraft((prev) => ({ ...prev, comparison: event.target.value }))}
                >
                  <option value="gt">&gt;</option>
                  <option value="gte">&gt;=</option>
                  <option value="lt">&lt;</option>
                  <option value="lte">&lt;=</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Threshold</Label>
                <Input
                  type="number"
                  value={alertDraft.threshold}
                  onChange={(event) => setAlertDraft((prev) => ({ ...prev, threshold: Number(event.target.value) }))}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" size="icon" variant="outline" disabled={createAlert.isPending || !alertDraft.metric_name}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </form>
            {alerts.length === 0 ? (
              <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No alert rules for this scope.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>{rule.name}</TableCell>
                      <TableCell className="font-mono text-xs">{rule.metric_name} {rule.comparison} {rule.threshold}</TableCell>
                      <TableCell><Badge variant={stateVariant(rule.last_state)}>{rule.last_state}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Alert Events</CardTitle></CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No alert events recorded.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>State</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell><Badge variant={stateVariant(event.state)}>{event.state}</Badge></TableCell>
                      <TableCell className="text-sm">{event.message}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
