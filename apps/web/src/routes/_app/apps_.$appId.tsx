import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { App, Build, Deployment, DeploymentTarget } from '@/lib/types'
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
import { Loader2, GitBranch, Box, Hammer, Activity, RotateCcw, Play, ChevronRight } from 'lucide-react'

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
        <TabsContent value="logs" className="mt-4">
          <ContainerLogsPanel appId={appId} />
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
