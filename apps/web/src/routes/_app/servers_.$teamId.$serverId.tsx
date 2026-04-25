import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { Server, ServerResources, ServerTag, ProvisioningJob } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useSSE } from '@/hooks/use-sse'
import { Terminal } from '@/components/terminal'
import { Loader2, Trash2, Plus, Cpu, HardDrive, Network, MemoryStick, Pencil, AlertTriangle, DownloadCloud } from 'lucide-react'

export const Route = createFileRoute('/_app/servers_/$teamId/$serverId')({
  component: ServerDetailPage,
})

interface ServerDetail extends Server {
  resources?: ServerResources
  tags?: ServerTag[]
  latest_job?: ProvisioningJob
}

interface ServerCleanupResult {
  request_id: string
  success: boolean
  output: string
  error: string
}

const PROVISION_COMPONENTS = ['docker', 'traefik', 'nixpacks', 'buildpacks', 'railpack']

// --- helpers ---

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 5000) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function formatUptime(_lastSeenAt: string | null, createdAt: string): string {
  // Use created_at as a proxy for uptime if the server is online
  const diff = Date.now() - new Date(createdAt).getTime()
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  const mins = Math.floor((diff % 3_600_000) / 60_000)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function diskColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 70) return 'bg-yellow-500'
  return 'bg-green-500'
}

// --- Status indicator ---

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: 'bg-green-500',
    degraded: 'bg-yellow-500',
    offline: 'bg-red-500',
    provisioning: 'bg-blue-500',
  }
  const pulse = status === 'online' || status === 'provisioning'
  const color = colors[status] ?? 'bg-gray-400'
  return (
    <span className="relative flex h-2.5 w-2.5">
      {pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-60`} />}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  )
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    online: 'bg-green-500 hover:bg-green-500',
    degraded: 'bg-yellow-500 hover:bg-yellow-500',
    offline: '',
    provisioning: '',
  }
  const variant = status === 'offline' ? 'destructive' : status === 'online' || status === 'degraded' ? 'default' : 'secondary'
  return (
    <div className="flex items-center gap-2">
      <StatusDot status={status} />
      <Badge variant={variant as 'default' | 'secondary' | 'destructive'} className={map[status] ?? ''}>
        {status}
      </Badge>
    </div>
  )
}

// --- Memory gauge ---

function MemoryGauge({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{pct}% used</span>
        <span className="text-muted-foreground">{formatBytes(used)} / {formatBytes(total)}</span>
      </div>
      <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Used: {formatBytes(used)}</span>
        <span>Free: {formatBytes(total - used)}</span>
      </div>
    </div>
  )
}

// --- CPU core grid ---

function CpuCoreGrid({ cores }: { cores: number }) {
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {Array.from({ length: cores }).map((_, i) => (
        <div
          key={i}
          className="w-5 h-5 rounded bg-green-500/20 border border-green-500/40 flex items-center justify-center"
          title={`Core ${i + 1}`}
        >
          <span className="text-[9px] font-mono text-green-600">{i + 1}</span>
        </div>
      ))}
    </div>
  )
}

// --- Disk bar ---

function DiskBar({ mount, used, total }: { mount: string; used: number; total: number }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0
  const color = diskColor(pct)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="font-mono font-medium">{mount}</span>
        <span className="text-muted-foreground">{pct}% &bull; {formatBytes(used)} / {formatBytes(total)}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}


// --- Main component ---

function ServerDetailPage() {
  const { teamId, serverId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [serverName, setServerName] = useState('')
  const [renameError, setRenameError] = useState('')
  const [selectedComponents, setSelectedComponents] = useState<string[]>([])
  const [sseUrl, setSseUrl] = useState<string | null>(null)
  const { messages: logMessages, connected: sseConnected, clear: clearLogs } = useSSE(sseUrl)
  const logRef = useRef<HTMLPreElement>(null)

  const [tagKey, setTagKey] = useState('')
  const [tagValue, setTagValue] = useState('')
  const [cleanupOptions, setCleanupOptions] = useState({
    remove_stopped_containers: true,
    remove_unused_images: false,
    remove_unused_networks: false,
    remove_build_cache: false,
    remove_volumes: false,
    older_than_hours: 24,
  })

  // Relative time ticker
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5000)
    return () => clearInterval(id)
  }, [])

  const { data: server, isLoading } = useQuery({
    queryKey: ['teams', teamId, 'servers', serverId],
    queryFn: () => api.get<ServerDetail>(`/teams/${teamId}/servers/${serverId}`),
    refetchInterval: 10_000,
  })

  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ['teams', teamId, 'servers', serverId, 'tags'],
    queryFn: () => api.get<ServerTag[]>(`/teams/${teamId}/servers/${serverId}/tags`),
  })

  const { data: latestJob } = useQuery({
    queryKey: ['teams', teamId, 'servers', serverId, 'latest-job'],
    queryFn: () => api.get<ProvisioningJob | null>(`/teams/${teamId}/servers/${serverId}/provision`),
    refetchInterval: 10_000,
  })

  useEffect(() => {
    if (server) setServerName(server.name)
  }, [server])

  useEffect(() => {
    if (latestJob && latestJob.status === 'running' && !sseUrl) {
      setSseUrl(`/api/v1/teams/${teamId}/servers/${serverId}/provision/${latestJob.id}/logs`)
    }
  }, [latestJob, sseUrl, teamId, serverId])

  const deleteServer = useMutation({
    mutationFn: () => api.delete(`/teams/${teamId}/servers/${serverId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'servers'] })
      navigate({ to: '/servers/$teamId', params: { teamId } })
      toast({ title: 'Server deleted' })
    },
    onError: (err) => {
      toast({ title: 'Error', description: err instanceof ApiError ? err.message : 'Failed to delete' })
    },
  })

  const renameServer = useMutation({
    mutationFn: (name: string) => api.put<Server>(`/teams/${teamId}/servers/${serverId}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'servers'] })
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'servers', serverId] })
      setRenameOpen(false)
      setRenameError('')
      toast({ title: 'Server renamed' })
    },
    onError: (err) => {
      setRenameError(err instanceof ApiError ? err.message : 'Failed to rename server')
    },
  })

  const startProvisioning = useMutation({
    mutationFn: (components: string[]) =>
      api.post<ProvisioningJob>(`/teams/${teamId}/servers/${serverId}/provision`, { components }),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'servers', serverId, 'latest-job'] })
      clearLogs()
      setSseUrl(`/api/v1/teams/${teamId}/servers/${serverId}/provision/${job.id}/logs`)
      toast({ title: 'Provisioning started' })
    },
    onError: (err) => {
      toast({ title: 'Error', description: err instanceof ApiError ? err.message : 'Failed to start provisioning' })
    },
  })

  const addTag = useMutation({
    mutationFn: (data: { key: string; value: string }) =>
      api.post<ServerTag>(`/teams/${teamId}/servers/${serverId}/tags`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'servers', serverId, 'tags'] })
      setTagKey('')
      setTagValue('')
      toast({ title: 'Tag added' })
    },
    onError: (err) => {
      toast({ title: 'Error', description: err instanceof ApiError ? err.message : 'Failed to add tag' })
    },
  })

  const deleteTag = useMutation({
    mutationFn: (tagId: string) => api.delete(`/teams/${teamId}/servers/${serverId}/tags/${tagId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'servers', serverId, 'tags'] })
      toast({ title: 'Tag deleted' })
    },
  })

  const cleanupServer = useMutation({
    mutationFn: () =>
      api.post<ServerCleanupResult>(`/teams/${teamId}/servers/${serverId}/cleanup`, cleanupOptions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'servers', serverId] })
      toast({ title: 'Server cleanup finished' })
    },
    onError: (err) => {
      toast({ title: 'Cleanup failed', description: err instanceof ApiError ? err.message : 'Failed to clean server' })
    },
  })

  const updateAgent = useMutation({
    mutationFn: () =>
      api.post<ProvisioningJob>(`/teams/${teamId}/servers/${serverId}/provision`, { components: ['agent'] }),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'servers', serverId, 'latest-job'] })
      clearLogs()
      setSseUrl(`/api/v1/teams/${teamId}/servers/${serverId}/provision/${job.id}/logs`)
      toast({ title: 'Agent update started' })
    },
    onError: (err) => {
      toast({ title: 'Agent update failed', description: err instanceof ApiError ? err.message : 'Failed to update agent' })
    },
  })

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logMessages])

  const toggleComponent = (comp: string) => {
    setSelectedComponents(prev =>
      prev.includes(comp) ? prev.filter(c => c !== comp) : [...prev, comp]
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!server) {
    return <div className="text-center py-12 text-muted-foreground">Server not found.</div>
  }

  const resources = server.resources
  const latestLogs = (() => {
    const dbLogs = latestJob?.logs || ''
    const liveLogs = logMessages.join('\n')
    return liveLogs ? (dbLogs ? dbLogs + '\n' + liveLogs : liveLogs) : dbLogs
  })()
  const isAgentUpdateJob = latestJob?.components.length === 1 && latestJob.components[0] === 'agent'
  const jobStatusVariant = latestJob?.status === 'completed' ? 'default' :
    latestJob?.status === 'failed' ? 'destructive' : 'secondary'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <StatusDot status={server.status} />
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{server.name}</h2>
            <p className="text-muted-foreground text-sm">{server.hostname}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Rename
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Server
          </Button>
        </div>
      </div>

      <Dialog open={renameOpen} onOpenChange={(isOpen) => {
        setRenameOpen(isOpen)
        if (!isOpen) {
          setServerName(server.name)
          setRenameError('')
        }
      }}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const nextName = serverName.trim()
              if (!nextName) {
                setRenameError('Server name is required.')
                return
              }
              renameServer.mutate(nextName)
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename Server</DialogTitle>
              <DialogDescription>Update the display name used in this team.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-2">
              {renameError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{renameError}</div>
              )}
              <Label htmlFor="server-name">Server name</Label>
              <Input
                id="server-name"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder="Production server"
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={renameServer.isPending || serverName.trim() === ''}>
                {renameServer.isPending ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Server</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{server.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteServer.isPending} onClick={() => deleteServer.mutate()}>
              {deleteServer.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="overview">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="provisioning">Provisioning</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="server-logs">Server Logs</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {/* Status hero card */}
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <StatusDot status={server.status} />
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Status</div>
                    <div className="flex items-center gap-2">
                      {statusBadge(server.status)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Last Seen</div>
                  <div className="text-sm font-medium" key={tick}>
                    {relativeTime(server.last_seen_at)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-0.5">Uptime (est.)</div>
                  <div className="text-sm font-medium font-mono">
                    {server.status === 'online' ? formatUptime(server.last_seen_at, server.created_at) : '—'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              { label: 'Name', value: server.name },
              { label: 'Hostname', value: server.hostname },
              { label: 'Public IP', value: server.public_ip },
              { label: 'SSH Port', value: String(server.ssh_port) },
              { label: 'SSH User', value: server.ssh_user },
              { label: 'OS', value: server.os ? `${server.os} ${server.os_version ?? ''}`.trim() : '—' },
              { label: 'Arch', value: server.arch ?? '—' },
              { label: 'Agent ID', value: server.agent_id ?? '—' },
              { label: 'Created', value: new Date(server.created_at).toLocaleString() },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <span className="font-medium text-sm font-mono">{value}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Resources Tab */}
        <TabsContent value="resources" className="space-y-4 mt-4">
          {!resources ? (
            <p className="text-center py-8 text-muted-foreground">No resource data available yet.</p>
          ) : (
            <>
              {/* CPU + Memory */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Cpu className="h-4 w-4" />
                      CPU
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm font-medium">{resources.cpu_model}</p>
                    <p className="text-sm text-muted-foreground">{resources.cpu_cores} core{resources.cpu_cores !== 1 ? 's' : ''}</p>
                    <CpuCoreGrid cores={resources.cpu_cores} />
                    <div className="flex flex-wrap gap-2 pt-1">
                      {resources.kernel_version && (
                        <Badge variant="outline" className="font-mono text-xs">
                          kernel {resources.kernel_version}
                        </Badge>
                      )}
                      {resources.docker_version && (
                        <Badge variant="outline" className="font-mono text-xs">
                          docker {resources.docker_version}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <MemoryStick className="h-4 w-4" />
                      Memory
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <MemoryGauge
                      used={resources.memory_total - resources.memory_available}
                      total={resources.memory_total}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Disk Usage */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <HardDrive className="h-4 w-4" />
                    Disk Usage
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {resources.disks.map((d) => (
                    <DiskBar
                      key={d.mount_point}
                      mount={d.mount_point}
                      used={d.used_bytes}
                      total={d.total_bytes}
                    />
                  ))}
                  <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" /> &lt;70%</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-yellow-500" /> 70–90%</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" /> &ge;90%</span>
                  </div>
                </CardContent>
              </Card>

              {/* Network Interfaces */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Network className="h-4 w-4" />
                    Network Interfaces
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {resources.network_interfaces.map((iface) => (
                      <div key={iface.name} className="rounded-lg border p-3 space-y-2">
                        <div className="font-mono text-sm font-semibold">{iface.name}</div>
                        <div className="flex flex-wrap gap-1">
                          {iface.ips.map((ip) => (
                            <Badge key={ip} variant="secondary" className="font-mono text-xs">{ip}</Badge>
                          ))}
                          {iface.ips.length === 0 && (
                            <span className="text-xs text-muted-foreground">No IPs</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Terminal Tab */}
        <TabsContent value="terminal" className="mt-4">
          <Terminal teamId={teamId} serverId={serverId} />
        </TabsContent>

        {/* Provisioning Tab */}
        <TabsContent value="provisioning" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle>Components</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PROVISION_COMPONENTS.map((comp) => (
                  <label key={comp} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedComponents.includes(comp)}
                      onChange={() => toggleComponent(comp)}
                      className="h-4 w-4"
                    />
                    <span className="text-sm font-medium">{comp}</span>
                  </label>
                ))}
              </div>
              <Button
                disabled={startProvisioning.isPending || selectedComponents.length === 0}
                onClick={() => startProvisioning.mutate(selectedComponents)}
              >
                {startProvisioning.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting...</>
                ) : 'Start Provisioning'}
              </Button>
            </CardContent>
          </Card>

          {latestJob && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Latest Job
                  <Badge variant={jobStatusVariant}>
                    {latestJob.status}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Components: {latestJob.components.join(', ')}
                </p>
                {latestJob.error && (
                  <p className="text-sm text-destructive">Error: {latestJob.error}</p>
                )}
              </CardContent>
            </Card>
          )}

          {latestJob && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Logs
                  {sseConnected && latestJob.status === 'running' && (
                    <span className="flex items-center gap-1 text-xs font-normal text-green-600">
                      <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                      Live
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre
                  ref={logRef}
                  className="bg-muted rounded-md p-4 text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap"
                >
                  {latestLogs || 'Waiting for logs...'}
                </pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tags Tab */}
        <TabsContent value="tags" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle>Add Tag</CardTitle></CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  addTag.mutate({ key: tagKey, value: tagValue })
                }}
                className="flex gap-2"
              >
                <div className="flex-1 space-y-1">
                  <Label htmlFor="tag-key">Key</Label>
                  <Input
                    id="tag-key"
                    value={tagKey}
                    onChange={(e) => setTagKey(e.target.value)}
                    placeholder="e.g., env"
                    required
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor="tag-value">Value</Label>
                  <Input
                    id="tag-value"
                    value={tagValue}
                    onChange={(e) => setTagValue(e.target.value)}
                    placeholder="e.g., production"
                    required
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={addTag.isPending}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {tagsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tags.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No tags yet.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tags.map((tag) => (
                    <TableRow key={tag.id}>
                      <TableCell className="font-mono text-sm">{tag.key}</TableCell>
                      <TableCell className="font-mono text-sm">{tag.value}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteTag.mutate(tag.id)}
                          disabled={deleteTag.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Server Logs Tab */}
        <TabsContent value="server-logs" className="mt-4 space-y-4">
          <ServerLogsPanel teamId={teamId} serverId={serverId} />
        </TabsContent>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <DownloadCloud className="h-4 w-4" />
                Agent Update
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                type="button"
                variant="outline"
                disabled={updateAgent.isPending}
                onClick={() => updateAgent.mutate()}
              >
                {updateAgent.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting...</>
                ) : 'Update Agent'}
              </Button>
              {isAgentUpdateJob && latestJob && (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Latest agent update</span>
                      <Badge variant={jobStatusVariant}>{latestJob.status}</Badge>
                    </div>
                    {sseConnected && latestJob.status === 'running' && (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                        Live
                      </span>
                    )}
                  </div>
                  {latestJob.error && (
                    <p className="text-sm text-destructive">{latestJob.error}</p>
                  )}
                  <pre
                    ref={logRef}
                    className="max-h-80 overflow-auto rounded-md bg-muted p-4 text-xs font-mono whitespace-pre-wrap"
                  >
                    {latestLogs || 'Waiting for logs...'}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Trash2 className="h-4 w-4" />
                Docker Cleanup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  cleanupServer.mutate()
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['remove_stopped_containers', 'Stopped containers'],
                    ['remove_unused_images', 'Unused images'],
                    ['remove_unused_networks', 'Unused networks'],
                    ['remove_build_cache', 'Build cache'],
                    ['remove_volumes', 'Unused volumes'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(cleanupOptions[key as keyof typeof cleanupOptions])}
                        onChange={(e) => setCleanupOptions((prev) => ({ ...prev, [key]: e.target.checked }))}
                        className="h-4 w-4"
                      />
                      <span className="font-medium">{label}</span>
                    </label>
                  ))}
                </div>
                <div className="grid gap-2 sm:max-w-xs">
                  <Label htmlFor="cleanup-age">Older than hours</Label>
                  <Input
                    id="cleanup-age"
                    type="number"
                    min={0}
                    value={cleanupOptions.older_than_hours}
                    onChange={(e) => setCleanupOptions((prev) => ({
                      ...prev,
                      older_than_hours: Math.max(0, Number(e.target.value) || 0),
                    }))}
                  />
                </div>
                {cleanupOptions.remove_volumes && (
                  <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Unused Docker volumes can contain data that is no longer attached to a container.</span>
                  </div>
                )}
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={cleanupServer.isPending || !Object.entries(cleanupOptions).some(([key, value]) => key !== 'older_than_hours' && value)}
                >
                  {cleanupServer.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Cleaning...</>
                  ) : 'Run Cleanup'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {cleanupServer.data && (
            <Card>
              <CardHeader><CardTitle className="text-base">Cleanup Output</CardTitle></CardHeader>
              <CardContent>
                <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs font-mono whitespace-pre-wrap">
                  {cleanupServer.data.output || 'Cleanup completed.'}
                </pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ServerLogsPanel({ teamId, serverId }: { teamId: string; serverId: string }) {
  const [unit, setUnit] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLines([])
    setConnected(false)

    const params = new URLSearchParams({ tail: '200', follow: 'true' })
    if (unit) params.set('unit', unit)

    const url = `/api/v1/teams/${teamId}/servers/${serverId}/logs?${params}`
    const es = new EventSource(url, { withCredentials: true })

    es.onopen = () => setConnected(true)
    es.onmessage = (e) => {
      setLines((prev) => [...prev, e.data])
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
  }, [teamId, serverId, unit])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Label className="text-sm">Unit Filter</Label>
        <select className="border rounded-md px-2 py-1 text-sm bg-background" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="">All</option>
          <option value="docker">Docker</option>
          <option value="nixway-agent">Nixway Agent</option>
          <option value="sshd">SSH</option>
        </select>
        {connected && <Badge variant="default" className="bg-green-500 hover:bg-green-500 text-xs">Live</Badge>}
      </div>
      <div className="bg-black rounded-lg p-4 font-mono text-xs max-h-[500px] overflow-y-auto">
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
