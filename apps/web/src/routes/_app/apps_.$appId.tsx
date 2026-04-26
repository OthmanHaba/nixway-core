import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { App, Build, Deployment, DeploymentTarget, ContainerReplica, ContainerInspect, ContainerLogEntry, ScalingEvent, AutoscalingRule, AutoscaleEvaluation, TrafficView } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, GitBranch, Box, Hammer, Activity, RotateCcw, Play, ChevronRight, Search, RefreshCw, Square, Cpu, MemoryStick, SlidersHorizontal, ServerCog } from 'lucide-react'

export const Route = createFileRoute('/_app/apps_/$appId')({
  component: AppDetailPage,
})

// --- helpers ---

function buildStatusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
    built: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    building: { variant: 'default', className: 'bg-blue-500 hover:bg-blue-500' },
    cloning: { variant: 'secondary' },
    pending: { variant: 'secondary' },
    failed: { variant: 'destructive' },
    cancelled: { variant: 'secondary' },
  }
  const cfg = map[status] ?? { variant: 'secondary' as const }
  return <Badge variant={cfg.variant} className={cfg.className}>{status}</Badge>
}

function deployStatusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
    healthy: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    deploying: { variant: 'default', className: 'bg-blue-500 hover:bg-blue-500' },
    pending: { variant: 'secondary' },
    degraded: { variant: 'default', className: 'bg-yellow-500 hover:bg-yellow-500' },
    failed: { variant: 'destructive' },
    rolled_back: { variant: 'secondary' },
  }
  const cfg = map[status] ?? { variant: 'secondary' as const }
  return <Badge variant={cfg.variant} className={cfg.className}>{status}</Badge>
}

function targetStatusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
    healthy: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    starting: { variant: 'default', className: 'bg-blue-500 hover:bg-blue-500' },
    pending: { variant: 'secondary' },
    failed: { variant: 'destructive' },
    stopped: { variant: 'secondary' },
  }
  const cfg = map[status] ?? { variant: 'secondary' as const }
  return <Badge variant={cfg.variant} className={cfg.className}>{status}</Badge>
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 5000) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function formatConstraintInput(values?: Record<string, string>) {
  return Object.entries(values || {}).map(([key, value]) => `${key}=${value}`).join(', ')
}

function parseConstraintInput(value: string) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const [key, ...rest] = part.split('=')
      const cleanKey = key?.trim()
      const cleanValue = rest.join('=').trim()
      if (cleanKey && cleanValue) acc[cleanKey] = cleanValue
      return acc
    }, {})
}

// --- SSE log viewer ---

function LogViewer({ url, title }: { url: string; title: string }) {
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLines([])
    const source = new EventSource(`/api/v1${url}`, { withCredentials: true })
    source.onopen = () => setConnected(true)
    source.onmessage = (e) => {
      setLines((prev) => [...prev, e.data])
    }
    source.onerror = () => {
      setConnected(false)
      source.close()
    }
    return () => { source.close(); setConnected(false) }
  }, [url])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Activity className="h-4 w-4" />
        {title}
        {connected ? (
          <Badge variant="default" className="bg-green-500 hover:bg-green-500 text-xs">Live</Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">Ended</Badge>
        )}
      </div>
      <div className="bg-black rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
        {lines.length === 0 ? (
          <span className="text-muted-foreground">Waiting for logs...</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="text-gray-300 py-0.5 whitespace-pre-wrap break-all">{line}</div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}

// --- Build detail dialog ---

function BuildDetailDialog({
  appId,
  build,
  onClose,
}: {
  appId: string
  build: Build
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Build <code className="font-mono text-sm">{build.commit_sha?.slice(0, 7) || build.id.slice(0, 8)}</code>
            {buildStatusBadge(build.status)}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Trigger</dt><dd>{build.trigger_type}</dd>
            <dt className="text-muted-foreground">Branch</dt><dd>{build.branch || '—'}</dd>
            <dt className="text-muted-foreground">Commit</dt>
            <dd><code className="font-mono text-xs">{build.commit_sha || '—'}</code></dd>
            <dt className="text-muted-foreground">Builder</dt><dd>{build.builder}</dd>
            <dt className="text-muted-foreground">Started</dt><dd>{relativeTime(build.started_at)}</dd>
            {build.completed_at && <><dt className="text-muted-foreground">Completed</dt><dd>{relativeTime(build.completed_at)}</dd></>}
            {build.error && <><dt className="text-muted-foreground text-red-500">Error</dt><dd className="text-red-500">{build.error}</dd></>}
          </dl>
          <LogViewer
            url={`/apps/${appId}/builds/${build.id}/logs`}
            title="Build Logs"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// --- Deployment detail dialog ---

function DeploymentDetailDialog({
  appId,
  deployment,
  onClose,
}: {
  appId: string
  deployment: Deployment
  onClose: () => void
}) {
  const { data: targets = [] } = useQuery({
    queryKey: ['apps', appId, 'deployments', deployment.id, 'targets'],
    queryFn: () => api.get<DeploymentTarget[]>(`/apps/${appId}/deployments/${deployment.id}/targets`),
  })

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Deployment {deployStatusBadge(deployment.status)}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {deployment.platform_domain && (
              <><dt className="text-muted-foreground">Domain</dt>
              <dd>
                <a href={`http://${deployment.platform_domain}`} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-500 hover:underline">
                  {deployment.platform_domain}
                </a>
              </dd></>
            )}
            <dt className="text-muted-foreground">Strategy</dt><dd>{deployment.strategy}</dd>
            <dt className="text-muted-foreground">Replicas</dt>
            <dd>{deployment.replicas_ready}/{deployment.replicas_desired} ready</dd>
            {deployment.commit_sha && (
              <><dt className="text-muted-foreground">Commit</dt>
              <dd><code className="font-mono text-xs">{deployment.commit_sha.slice(0, 7)}</code></dd></>
            )}
            <dt className="text-muted-foreground">Started</dt><dd>{relativeTime(deployment.started_at)}</dd>
            {deployment.error && <><dt className="text-muted-foreground text-red-500">Error</dt><dd className="text-red-500">{deployment.error}</dd></>}
          </dl>

          {targets.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Targets</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Server</TableHead>
                    <TableHead>Container</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Healthy At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {targets.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-sm">{t.server_name || t.server_id}</TableCell>
                      <TableCell>
                        {t.container_id ? (
                          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                            {t.container_id.slice(0, 12)}
                          </code>
                        ) : '—'}
                      </TableCell>
                      <TableCell>{targetStatusBadge(t.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{relativeTime(t.healthy_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <LogViewer
            url={`/apps/${appId}/deployments/${deployment.id}/logs`}
            title="Deployment Logs"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// --- Main page ---

function ContainerLogsPanel({ appId }: { appId: string }) {
  const logsRef = useRef<HTMLPreElement>(null)
  const [logs, setLogs] = useState('')
  const [connected, setConnected] = useState(false)
  const [selectedContainer, setSelectedContainer] = useState('')
  const queryClient = useQueryClient()

  const { data: deployments = [] } = useQuery({
    queryKey: ['apps', appId, 'deployments', 'for-logs'],
    queryFn: () => api.get<Deployment[]>(`/apps/${appId}/deployments?limit=10`),
  })

  const cleanup = useMutation({
    mutationFn: () => api.post(`/apps/${appId}/cleanup`),
    onSuccess: (data: any) => {
      alert(data.message || 'Cleanup done')
      queryClient.invalidateQueries({ queryKey: ['apps', appId] })
    },
  })

  // Connect to logs SSE
  useEffect(() => {
    setLogs('')
    setConnected(false)

    const params = new URLSearchParams({ tail: '200', follow: 'true' })
    if (selectedContainer) {
      params.set('container', selectedContainer)
    }

    const url = `/api/v1/apps/${appId}/logs?${params}`
    const es = new EventSource(url, { withCredentials: true })

    es.onopen = () => setConnected(true)

    es.onmessage = (e) => {
      setLogs((prev) => prev + e.data + '\n')
    }

    es.addEventListener('done', () => {
      setConnected(false)
      es.close()
    })

    es.onerror = () => {
      setConnected(false)
      es.close()
    }

    return () => { es.close() }
  }, [appId, selectedContainer])

  // Auto-scroll
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [logs])

  // Build container options from deployments
  const containerOptions = deployments
    .filter(d => d.status === 'healthy' || d.status === 'deploying')
    .map(d => ({
      name: `nixway-${d.image_tag?.split('/')[1]?.split(':')[0] || 'app'}-${d.id.slice(0, 8)}`,
      label: `${d.status} — ${d.image_tag || 'unknown'} (${new Date(d.created_at).toLocaleString()})`,
      id: d.id,
    }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Container</span>
          {containerOptions.length > 0 ? (
            <select
              className="border rounded-md px-2 py-1 text-sm bg-background"
              value={selectedContainer}
              onChange={(e) => setSelectedContainer(e.target.value)}
            >
              <option value="">Latest</option>
              {containerOptions.map((c) => (
                <option key={c.id} value={c.name}>{c.label}</option>
              ))}
            </select>
          ) : (
            <span className="text-sm text-muted-foreground">No active deployments</span>
          )}
          {connected && <Badge variant="default" className="bg-green-500 hover:bg-green-500 text-xs">Live</Badge>}
        </div>
        <Button size="sm" variant="destructive" onClick={() => cleanup.mutate()} disabled={cleanup.isPending}>
          {cleanup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cleanup Old Containers'}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {logs ? (
            <pre
              ref={logsRef}
              className="bg-black text-green-400 text-xs font-mono p-4 rounded-md overflow-auto max-h-[500px] whitespace-pre-wrap"
            >
              {logs}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              {connected ? 'Waiting for logs...' : 'No running containers found. Deploy the app first.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// --- Container Inspect Panel ---

function InspectPanel({ appId }: { appId: string }) {
  const { data: replicas = [] } = useQuery({
    queryKey: ['apps', appId, 'replicas'],
    queryFn: () => api.get<ContainerReplica[]>(`/apps/${appId}/replicas`),
  })

  const [selectedContainer, setSelectedContainer] = useState('')
  const [inspectData, setInspectData] = useState<ContainerInspect | null>(null)
  const [loading, setLoading] = useState(false)

  // Build container name from latest deployment
  const { data: deploys = [] } = useQuery({
    queryKey: ['apps', appId, 'deployments', 'for-inspect'],
    queryFn: () => api.get<Deployment[]>(`/apps/${appId}/deployments?limit=1`),
  })

  const { data: app } = useQuery({
    queryKey: ['apps', appId],
    queryFn: () => api.get<App>(`/apps/${appId}`),
  })

  const containerName = selectedContainer || (deploys.length > 0 && app
    ? `nixway-${app.slug}-${deploys[0].id.slice(0, 8)}`
    : '')

  const fetchInspect = async () => {
    if (!containerName) return
    setLoading(true)
    try {
      const data = await api.get<ContainerInspect>(`/apps/${appId}/containers/${containerName}/inspect`)
      setInspectData(data)
    } catch {
      setInspectData(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (containerName) fetchInspect()
  }, [containerName])

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return 'No limit'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Container: {containerName || 'None'}</span>
        <Button size="sm" variant="outline" onClick={fetchInspect} disabled={loading || !containerName}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {replicas.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="inspect-container">Inspect replica</Label>
          <select
            id="inspect-container"
            value={selectedContainer}
            onChange={(e) => setSelectedContainer(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Latest deployment default</option>
            {replicas.map((replica) => (
              <option key={`${replica.server_id}-${replica.container_id ?? 'pending'}`} value={replica.container_id ?? ''}>
                {replica.server_name}{replica.container_id ? ` - ${replica.container_id}` : ' - pending'}
              </option>
            ))}
          </select>
        </div>
      )}

      {inspectData ? (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Status</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Status</dt>
                <dd><Badge variant={inspectData.status === 'running' ? 'default' : 'secondary'} className={inspectData.status === 'running' ? 'bg-green-500 hover:bg-green-500' : ''}>{inspectData.status}</Badge></dd>
                <dt className="text-muted-foreground">Image</dt><dd className="font-mono text-xs">{inspectData.image}</dd>
                <dt className="text-muted-foreground">PID</dt><dd>{inspectData.pid}</dd>
                <dt className="text-muted-foreground">Restart Count</dt><dd>{inspectData.restart_count}</dd>
                <dt className="text-muted-foreground">Network IP</dt><dd className="font-mono text-xs">{inspectData.network_ip}</dd>
                <dt className="text-muted-foreground">Ports</dt><dd className="font-mono text-xs">{inspectData.ports?.join(', ') || 'none'}</dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Resources</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Memory Usage</dt><dd>{formatBytes(inspectData.memory_usage)}</dd>
                <dt className="text-muted-foreground">Memory Limit</dt><dd>{formatBytes(inspectData.memory_limit)}</dd>
                <dt className="text-muted-foreground">CPU</dt><dd>{inspectData.cpu_percent}%</dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Environment Variables</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {Object.entries(inspectData.env || {}).map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-xs font-mono">
                    <span className="text-muted-foreground min-w-0 shrink-0">{k}=</span>
                    <span className={v.startsWith('SECRET_REF:') ? 'text-yellow-500' : 'text-foreground'}>{v}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">
          {loading ? 'Loading...' : 'No container to inspect. Deploy the app first.'}
        </p>
      )}
    </div>
  )
}

// --- Resource Limits Panel ---

function ResourceLimitsPanel({ app, appId }: { app: App; appId: string }) {
  const queryClient = useQueryClient()
  const [memoryMb, setMemoryMb] = useState(String(app.memory_limit_mb || 0))
  const [cpuMillicores, setCpuMillicores] = useState(String(app.cpu_limit_millicores || 0))

  const updateResources = useMutation({
    mutationFn: (data: { memory_limit_mb: number; cpu_limit_millicores: number }) =>
      api.put(`/apps/${appId}/resources`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apps', appId] })
    },
  })

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Resource Limits</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Set memory and CPU limits for containers. 0 means no limit.
          Changing limits will take effect on the next deployment.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="flex items-center gap-1.5"><MemoryStick className="h-3.5 w-3.5" /> Memory (MB)</Label>
            <Input type="number" value={memoryMb} onChange={(e) => setMemoryMb(e.target.value)} placeholder="0 = no limit" />
          </div>
          <div>
            <Label className="flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> CPU (millicores)</Label>
            <Input type="number" value={cpuMillicores} onChange={(e) => setCpuMillicores(e.target.value)} placeholder="0 = no limit" />
            <p className="text-xs text-muted-foreground mt-1">1000 = 1 CPU core</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => updateResources.mutate({
            memory_limit_mb: parseInt(memoryMb, 10) || 0,
            cpu_limit_millicores: parseInt(cpuMillicores, 10) || 0,
          })}
          disabled={updateResources.isPending}
        >
          {updateResources.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Resource Limits
        </Button>
      </CardContent>
    </Card>
  )
}

// --- Scaling Panel ---

function ScalingPanel({ app, appId }: { app: App; appId: string }) {
  const queryClient = useQueryClient()
  const [replicas, setReplicas] = useState(String(app.replicas))
  const [strategy, setStrategy] = useState(app.placement_strategy || 'spread')
  const [mustHave, setMustHave] = useState(formatConstraintInput(app.placement_constraints?.must_have))
  const [mustNotHave, setMustNotHave] = useState(formatConstraintInput(app.placement_constraints?.must_not_have))
  const [pinnedServers, setPinnedServers] = useState((app.pinned_server_ids || []).join(', '))
  const [error, setError] = useState('')
  const [ruleName, setRuleName] = useState('CPU scale up')
  const [threshold, setThreshold] = useState('80')
  const [maxReplicas, setMaxReplicas] = useState('10')
  const [evaluation, setEvaluation] = useState<AutoscaleEvaluation[]>([])

  const { data: events = [] } = useQuery({
    queryKey: ['apps', appId, 'scaling-events'],
    queryFn: () => api.get<ScalingEvent[]>(`/apps/${appId}/scaling-events`),
    refetchInterval: 15_000,
  })

  const { data: rules = [] } = useQuery({
    queryKey: ['apps', appId, 'autoscaling-rules'],
    queryFn: () => api.get<AutoscalingRule[]>(`/apps/${appId}/autoscaling-rules`),
  })

  const scale = useMutation({
    mutationFn: () => api.post(`/apps/${appId}/scale`, {
      replicas: parseInt(replicas, 10) || 1,
      placement_strategy: strategy,
      placement_constraints: {
        must_have: parseConstraintInput(mustHave),
        must_not_have: parseConstraintInput(mustNotHave),
      },
      pinned_server_ids: pinnedServers
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    }),
    onSuccess: () => {
      setError('')
      queryClient.invalidateQueries({ queryKey: ['apps', appId] })
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'deployments'] })
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'replicas'] })
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'scaling-events'] })
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Scaling failed')
    },
  })

  const createRule = useMutation({
    mutationFn: () => api.post<AutoscalingRule>(`/apps/${appId}/autoscaling-rules`, {
      name: ruleName,
      metric_name: 'cpu_percent',
      comparison: 'gt',
      threshold: parseFloat(threshold) || 80,
      duration_seconds: 120,
      action_type: 'scale_by',
      action_value: 1,
      min_replicas: Math.max(1, parseInt(replicas, 10) || 1),
      max_replicas: parseInt(maxReplicas, 10) || 10,
      cooldown_up_seconds: 60,
      cooldown_down_seconds: 300,
      enabled: true,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'autoscaling-rules'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create autoscaling rule'),
  })

  const evaluateRules = useMutation({
    mutationFn: () => api.post<AutoscaleEvaluation[]>(`/apps/${appId}/autoscaling/evaluate`),
    onSuccess: (data) => {
      setEvaluation(data)
      queryClient.invalidateQueries({ queryKey: ['apps', appId] })
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'deployments'] })
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'scaling-events'] })
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'autoscaling-rules'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Autoscaling evaluation failed'),
  })

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <SlidersHorizontal className="h-4 w-4" />
            Scaling
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Replicas</Label>
              <Input type="number" min={1} value={replicas} onChange={(e) => setReplicas(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>Placement</Label>
              <Select value={strategy} onValueChange={(value) => setStrategy(value as App['placement_strategy'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="spread">Spread</SelectItem>
                  <SelectItem value="binpack">Binpack</SelectItem>
                  <SelectItem value="pinned">Pinned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Must-have tags</Label>
              <Input value={mustHave} onChange={(e) => setMustHave(e.target.value)} placeholder="env=prod, gpu=true" />
            </div>
            <div>
              <Label>Must-not-have tags</Label>
              <Input value={mustNotHave} onChange={(e) => setMustNotHave(e.target.value)} placeholder="role=db" />
            </div>
          </div>

          {strategy === 'pinned' && (
            <div>
              <Label className="flex items-center gap-1.5">
                <ServerCog className="h-3.5 w-3.5" />
                Pinned server IDs
              </Label>
              <Input value={pinnedServers} onChange={(e) => setPinnedServers(e.target.value)} placeholder="server-id-1, server-id-2" />
            </div>
          )}

          <Button size="sm" onClick={() => scale.mutate()} disabled={scale.isPending}>
            {scale.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SlidersHorizontal className="mr-2 h-4 w-4" />}
            Apply Scaling
          </Button>
        </CardContent>
        </Card>

        <Card>
        <CardHeader><CardTitle className="text-sm">Scaling Events</CardTitle></CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No scaling events yet.</p>
          ) : (
            <div className="space-y-3">
              {events.slice(0, 6).map((event) => (
                <div key={event.id} className="border-l pl-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{event.from_replicas} → {event.to_replicas} replicas</span>
                    <Badge variant="secondary">{event.placement_strategy}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{event.message || event.event_type}</p>
                  <p className="text-xs text-muted-foreground mt-1">{relativeTime(event.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Autoscaling</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Rule name</Label>
              <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} />
            </div>
            <div>
              <Label>CPU threshold</Label>
              <Input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </div>
            <div>
              <Label>Max replicas</Label>
              <Input type="number" value={maxReplicas} onChange={(e) => setMaxReplicas(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => createRule.mutate()} disabled={createRule.isPending}>
              {createRule.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Rule
            </Button>
            <Button size="sm" variant="outline" onClick={() => evaluateRules.mutate()} disabled={evaluateRules.isPending || rules.length === 0}>
              {evaluateRules.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Evaluate Now
            </Button>
          </div>

          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No autoscaling rules.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Last</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{rule.metric_name} {rule.comparison} {rule.threshold}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">+{rule.action_value}, max {rule.max_replicas}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{relativeTime(rule.last_triggered_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {evaluation.length > 0 && (
            <div className="space-y-2">
              {evaluation.map((item) => (
                <div key={item.rule_id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{item.rule_name}: {item.metric_value.toFixed(1)}%</span>
                  <Badge variant={item.triggered ? 'default' : 'secondary'}>{item.message}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function TrafficPanel({ appId }: { appId: string }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const { data: traffic } = useQuery({
    queryKey: ['apps', appId, 'traffic'],
    queryFn: () => api.get<TrafficView>(`/apps/${appId}/traffic`),
    refetchInterval: 15_000,
  })

  const updateTraffic = useMutation({
    mutationFn: (weights: { backend_id: string; weight: number }[]) =>
      api.put<TrafficView>(`/apps/${appId}/traffic`, { weights }),
    onSuccess: () => {
      setError('')
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'traffic'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to update traffic'),
  })

  const promote = useMutation({
    mutationFn: (backendId: string) =>
      api.post<TrafficView>(`/apps/${appId}/traffic/backends/${backendId}/promote`),
    onSuccess: () => {
      setError('')
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'traffic'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to promote backend'),
  })

  const backends = traffic?.backends ?? []
  const applySplit = (weights: number[]) => {
    updateTraffic.mutate(backends.map((backend, index) => ({
      backend_id: backend.id,
      weight: weights[index] ?? 0,
    })))
  }

  if (!traffic?.route) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Traffic</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Traffic groups appear after an app has a healthy deployment.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Traffic Route</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{traffic.route.domain}</p>
              <p className="text-xs text-muted-foreground">{traffic.route.mode} routing</p>
            </div>
            <div className="flex gap-2">
              {backends.length >= 2 && (
                <>
                  <Button size="sm" variant="outline" onClick={() => applySplit([100, 0])}>100/0</Button>
                  <Button size="sm" variant="outline" onClick={() => applySplit([90, 10])}>90/10</Button>
                  <Button size="sm" variant="outline" onClick={() => applySplit([50, 50])}>50/50</Button>
                  <Button size="sm" variant="outline" onClick={() => applySplit([0, 100])}>0/100</Button>
                </>
              )}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Backend</TableHead>
                <TableHead>Commit</TableHead>
                <TableHead>Replicas</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {backends.map((backend) => (
                <TableRow key={backend.id}>
                  <TableCell>
                    <div className="font-medium">{backend.label || backend.deployment_id.slice(0, 8)}</div>
                    <div className="text-xs text-muted-foreground">{backend.deployment_status}</div>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                      {backend.commit_sha ? backend.commit_sha.slice(0, 7) : backend.deployment_id.slice(0, 8)}
                    </code>
                  </TableCell>
                  <TableCell className="text-sm">{backend.replicas_ready}/{backend.replicas_desired}</TableCell>
                  <TableCell className="text-sm font-medium">{backend.weight}%</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => promote.mutate(backend.id)} disabled={promote.isPending}>
                      Promote
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Traffic Events</CardTitle></CardHeader>
        <CardContent>
          {(traffic.events ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No traffic events.</p>
          ) : (
            <div className="space-y-3">
              {traffic.events.map((event) => (
                <div key={event.id} className="border-l pl-3">
                  <p className="text-sm font-medium">{event.message || event.event_type}</p>
                  <p className="text-xs text-muted-foreground">{relativeTime(event.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// --- Log Search Panel ---

function LogSearchPanel({ appId }: { appId: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ContainerLogEntry[]>([])
  const [searching, setSearching] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      const data = await api.get<ContainerLogEntry[]>(
        `/apps/${appId}/logs/search?q=${encodeURIComponent(query)}&limit=200`
      )
      setResults(data)
    } catch {
      setResults([])
    }
    setSearching(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search logs (full-text)..."
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button size="sm" onClick={handleSearch} disabled={searching || !query.trim()}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      {results.length > 0 ? (
        <div className="bg-black rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
          {results.map((entry) => (
            <div key={entry.id} className="text-gray-300 py-0.5 whitespace-pre-wrap break-all">
              <span className="text-gray-500">{new Date(entry.logged_at).toLocaleTimeString()}</span>
              {' '}
              <span className="text-blue-400">[{entry.container_name}]</span>
              {' '}
              {entry.line}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">
          {searching ? 'Searching...' : 'Search historical container logs (last 7 days).'}
        </p>
      )}
    </div>
  )
}

// --- Lifecycle Controls ---

function LifecycleControls({ appId }: { appId: string }) {
  const queryClient = useQueryClient()
  const { data: replicas = [], isLoading } = useQuery({
    queryKey: ['apps', appId, 'replicas'],
    queryFn: () => api.get<ContainerReplica[]>(`/apps/${appId}/replicas`),
    refetchInterval: 10_000,
  })

  const { data: deploys = [] } = useQuery({
    queryKey: ['apps', appId, 'deployments', 'for-lifecycle'],
    queryFn: () => api.get<Deployment[]>(`/apps/${appId}/deployments?limit=1`),
  })

  const { data: app } = useQuery({
    queryKey: ['apps', appId],
    queryFn: () => api.get<App>(`/apps/${appId}`),
  })

  const restart = useMutation({
    mutationFn: (containerName: string) =>
      api.post(`/apps/${appId}/containers/${containerName}/restart`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'replicas'] })
    },
  })

  const stop = useMutation({
    mutationFn: (containerName: string) =>
      api.post(`/apps/${appId}/containers/${containerName}/stop`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'replicas'] })
    },
  })

  const containerName = deploys.length > 0 && app
    ? `nixway-${app.slug}-${deploys[0].id.slice(0, 8)}`
    : ''

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin" />

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Active Replicas</CardTitle></CardHeader>
      <CardContent>
        {replicas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active replicas.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {replicas.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm">{r.server_name}</TableCell>
                  <TableCell><code className="text-xs font-mono">{r.container_id?.slice(0, 12) || containerName}</code></TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline"
                        onClick={() => restart.mutate(containerName)}
                        disabled={restart.isPending}
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Restart
                      </Button>
                      <Button size="sm" variant="destructive"
                        onClick={() => { if (confirm('Stop this container?')) stop.mutate(containerName) }}
                        disabled={stop.isPending}
                      >
                        <Square className="h-3.5 w-3.5 mr-1" /> Stop
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function DomainsCard({ app, appId }: { app: App; appId: string }) {
  const queryClient = useQueryClient()
  const [customDomain, setCustomDomain] = useState(app.custom_domain || '')
  const [verifyResult, setVerifyResult] = useState<{ verified: boolean; target: string } | null>(null)

  const setDomain = useMutation({
    mutationFn: (domain: string) => api.post(`/apps/${appId}/domain`, { custom_domain: domain }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apps', appId] })
    },
  })

  const verifyDomain = useMutation({
    mutationFn: () => api.post<{ domain: string; verified: boolean; target: string }>(`/apps/${appId}/domain/verify`),
    onSuccess: (data) => {
      setVerifyResult(data)
      queryClient.invalidateQueries({ queryKey: ['apps', appId] })
    },
  })

  // Generate the platform domain (same logic as backend)
  const latestDeploy = useQuery({
    queryKey: ['apps', appId, 'deployments', 'latest'],
    queryFn: () => api.get<Deployment[]>(`/apps/${appId}/deployments?limit=1`),
  })

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Domains</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {/* Platform domain info */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Platform Domain (auto-generated)</p>
          <p className="text-xs text-muted-foreground">
            The platform domain is generated on deploy using nip.io. Check deployment logs for the exact URL.
          </p>
          {latestDeploy.data && latestDeploy.data.length > 0 && latestDeploy.data[0].status === 'healthy' && (
            <Badge variant="default" className="bg-green-500 hover:bg-green-500">Deployed</Badge>
          )}
        </div>

        {/* Custom domain */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Custom Domain</p>
          <div className="flex gap-2">
            <Input
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder="app.example.com"
              className="text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDomain.mutate(customDomain)}
              disabled={setDomain.isPending || !customDomain.trim()}
            >
              {setDomain.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Set'}
            </Button>
          </div>

          {app.custom_domain && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{app.custom_domain}</span>
              {app.domain_verified ? (
                <Badge variant="default" className="bg-green-500 hover:bg-green-500 text-xs">Verified</Badge>
              ) : (
                <>
                  <Badge variant="secondary" className="text-xs">Unverified</Badge>
                  <Button size="sm" variant="ghost" className="text-xs h-6"
                    onClick={() => verifyDomain.mutate()}
                    disabled={verifyDomain.isPending}
                  >
                    {verifyDomain.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Verify DNS'}
                  </Button>
                </>
              )}
            </div>
          )}

          {verifyResult && (
            <p className={`text-xs ${verifyResult.verified ? 'text-green-600' : 'text-red-500'}`}>
              {verifyResult.verified
                ? `DNS verified — resolves to ${verifyResult.target}`
                : 'DNS verification failed. Point a CNAME or A record to your server IP.'}
            </p>
          )}

          {app.custom_domain && !app.domain_verified && (
            <p className="text-xs text-muted-foreground">
              Point a CNAME record for <code className="font-mono">{app.custom_domain}</code> to your server's IP, then click "Verify DNS".
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function EditAppDialog({ app, appId, open, onClose }: { app: App; appId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [builder, setBuilder] = useState(app.builder)
  const [port, setPort] = useState(String(app.port))
  const [healthPath, setHealthPath] = useState(app.health_check_path)
  const [replicas, setReplicas] = useState(String(app.replicas))
  const [branch, setBranch] = useState(app.branch || '')
  const [rootPath, setRootPath] = useState(app.root_path)
  const [dockerfilePath, setDockerfilePath] = useState(app.dockerfile_path)
  const [error, setError] = useState('')

  const updateApp = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.put<App>(`/projects/${app.project_id}/apps/${appId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apps', appId] })
      onClose()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to update app')
    },
  })

  const handleSave = () => {
    updateApp.mutate({
      name: app.name,
      builder,
      port: parseInt(port, 10) || 3000,
      health_check_path: healthPath,
      health_check_interval: app.health_check_interval,
      health_check_timeout: app.health_check_timeout,
      replicas: parseInt(replicas, 10) || 1,
      branch: branch || null,
      root_path: rootPath,
      dockerfile_path: dockerfilePath,
      auto_deploy: app.auto_deploy,
      subdomain: app.subdomain,
      custom_domain: app.custom_domain,
      status: app.status,
      placement_strategy: app.placement_strategy,
      placement_constraints: app.placement_constraints,
      pinned_server_ids: app.pinned_server_ids,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit App Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div>
            <Label>Builder</Label>
            <Select value={builder} onValueChange={setBuilder}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                <SelectItem value="dockerfile">Dockerfile</SelectItem>
                <SelectItem value="nixpacks">Nixpacks</SelectItem>
                <SelectItem value="buildpacks">Buildpacks</SelectItem>
                <SelectItem value="railpack">Railpack</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {builder === 'dockerfile' && (
            <div>
              <Label>Dockerfile Path</Label>
              <Input value={dockerfilePath} onChange={(e) => setDockerfilePath(e.target.value)} placeholder="Dockerfile" />
            </div>
          )}
          {app.source_type === 'github' && (
            <>
              <div>
                <Label>Branch</Label>
                <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
              </div>
              <div>
                <Label>Root Path</Label>
                <Input value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder="/" />
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Port</Label>
              <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
            <div>
              <Label>Replicas</Label>
              <Input type="number" value={replicas} onChange={(e) => setReplicas(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Health Check Path</Label>
            <Input value={healthPath} onChange={(e) => setHealthPath(e.target.value)} placeholder="/healthz" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateApp.isPending}>
            {updateApp.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AppDetailPage() {
  const { appId } = Route.useParams()
  const queryClient = useQueryClient()
  const [selectedBuild, setSelectedBuild] = useState<Build | null>(null)
  const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const { data: app, isLoading } = useQuery({
    queryKey: ['apps', appId],
    queryFn: () => api.get<App>(`/apps/${appId}`),
  })

  const { data: builds = [], isLoading: buildsLoading } = useQuery({
    queryKey: ['apps', appId, 'builds'],
    queryFn: () => api.get<Build[]>(`/apps/${appId}/builds`),
    refetchInterval: 15_000,
  })

  const { data: deployments = [], isLoading: deploymentsLoading } = useQuery({
    queryKey: ['apps', appId, 'deployments'],
    queryFn: () => api.get<Deployment[]>(`/apps/${appId}/deployments`),
    refetchInterval: 15_000,
  })

  const triggerBuild = useMutation({
    mutationFn: () => api.post<Build>(`/apps/${appId}/builds`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'builds'] })
    },
  })

  const rollback = useMutation({
    mutationFn: (deploymentId: string) =>
      api.post(`/apps/${appId}/rollback`, { deployment_id: deploymentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apps', appId, 'deployments'] })
    },
    onError: (err) => {
      alert(err instanceof ApiError ? err.message : 'Rollback failed')
    },
  })

  if (isLoading || !app) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {app.source_type === 'github'
            ? <GitBranch className="h-6 w-6 text-muted-foreground" />
            : <Box className="h-6 w-6 text-muted-foreground" />}
          <div>
            <h1 className="text-2xl font-bold">{app.name}</h1>
            <p className="text-muted-foreground text-sm">
              {app.source_type === 'github'
                ? `${app.repo_full_name || ''}${app.branch ? ` (${app.branch})` : ''}`
                : app.docker_image || ''}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          Edit Settings
        </Button>
      </div>

      {editOpen && <EditAppDialog app={app} appId={appId} open={editOpen} onClose={() => setEditOpen(false)} />}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="builds">Builds ({builds.length})</TabsTrigger>
          <TabsTrigger value="deployments">Deployments ({deployments.length})</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
          <TabsTrigger value="scaling">Scaling</TabsTrigger>
          <TabsTrigger value="traffic">Traffic</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Status</CardTitle></CardHeader>
              <CardContent>
                <Badge variant={app.status === 'active' || app.status === 'healthy' ? 'default' : 'secondary'}
                  className={app.status === 'active' || app.status === 'healthy' ? 'bg-green-500 hover:bg-green-500' : ''}>
                  {app.status}
                </Badge>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Replicas</CardTitle></CardHeader>
              <CardContent><span className="text-2xl font-bold">{app.replicas}</span></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Port</CardTitle></CardHeader>
              <CardContent><span className="text-2xl font-bold">{app.port}</span></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Configuration</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Source</dt>
                <dd>{app.source_type === 'github' ? 'GitHub' : 'Docker Image'}</dd>

                {app.source_type === 'github' && (
                  <>
                    <dt className="text-muted-foreground">Repository</dt>
                    <dd className="font-mono text-xs">{app.repo_full_name || '—'}</dd>
                    <dt className="text-muted-foreground">Branch</dt>
                    <dd>{app.branch || '—'}</dd>
                    <dt className="text-muted-foreground">Auto Deploy</dt>
                    <dd>{app.auto_deploy ? 'Yes' : 'No'}</dd>
                  </>
                )}

                {app.source_type === 'docker_image' && (
                  <>
                    <dt className="text-muted-foreground">Image</dt>
                    <dd className="font-mono text-xs">{app.docker_image || '—'}</dd>
                  </>
                )}

                <dt className="text-muted-foreground">Builder</dt>
                <dd className="flex items-center gap-1.5">
                  <Hammer className="h-3.5 w-3.5 text-muted-foreground" />
                  {app.builder}
                </dd>

                <dt className="text-muted-foreground">Health Check</dt>
                <dd className="font-mono text-xs">{app.health_check_path}</dd>

                <dt className="text-muted-foreground">Placement</dt>
                <dd>{app.placement_strategy}</dd>

                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(app.created_at).toLocaleString()}</dd>
              </dl>
            </CardContent>
          </Card>

          <DomainsCard app={app} appId={appId} />
        </TabsContent>

        {/* Builds */}
        <TabsContent value="builds" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => triggerBuild.mutate()} disabled={triggerBuild.isPending}>
              {triggerBuild.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Play className="mr-2 h-4 w-4" />}
              Trigger Build
            </Button>
          </div>

          {buildsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : builds.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Hammer className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No builds yet. Trigger a build to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Commit</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Builder</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {builds.map((b) => (
                  <TableRow
                    key={b.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedBuild(b)}
                  >
                    <TableCell>
                      <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                        {b.commit_sha ? b.commit_sha.slice(0, 7) : b.id.slice(0, 8)}
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{b.branch || '—'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{b.trigger_type}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{b.builder}</TableCell>
                    <TableCell>{buildStatusBadge(b.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{relativeTime(b.started_at)}</TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* Deployments */}
        <TabsContent value="deployments" className="space-y-4 mt-4">
          {deploymentsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : deployments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Activity className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No deployments yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Commit</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Replicas</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.map((d) => (
                  <TableRow
                    key={d.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedDeployment(d)}
                  >
                    <TableCell>
                      {d.commit_sha ? (
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                          {d.commit_sha.slice(0, 7)}
                        </code>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{d.strategy}</TableCell>
                    <TableCell className="text-sm">
                      {d.replicas_ready}/{d.replicas_desired}
                    </TableCell>
                    <TableCell>{deployStatusBadge(d.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{relativeTime(d.started_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {d.status !== 'rolled_back' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => rollback.mutate(d.id)}
                            disabled={rollback.isPending}
                          >
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                            Rollback
                          </Button>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* Container Logs */}
        <TabsContent value="logs" className="mt-4 space-y-6">
          <ContainerLogsPanel appId={appId} />
          <LogSearchPanel appId={appId} />
        </TabsContent>

        {/* Inspect */}
        <TabsContent value="inspect" className="mt-4 space-y-4">
          <LifecycleControls appId={appId} />
          <InspectPanel appId={appId} />
        </TabsContent>

        {/* Scaling */}
        <TabsContent value="scaling" className="mt-4">
          <ScalingPanel app={app} appId={appId} />
        </TabsContent>

        {/* Traffic */}
        <TabsContent value="traffic" className="mt-4">
          <TrafficPanel appId={appId} />
        </TabsContent>

        {/* Resources */}
        <TabsContent value="resources" className="mt-4">
          <ResourceLimitsPanel app={app} appId={appId} />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {selectedBuild && (
        <BuildDetailDialog
          appId={appId}
          build={selectedBuild}
          onClose={() => setSelectedBuild(null)}
        />
      )}
      {selectedDeployment && (
        <DeploymentDetailDialog
          appId={appId}
          deployment={selectedDeployment}
          onClose={() => setSelectedDeployment(null)}
        />
      )}
    </div>
  )
}
