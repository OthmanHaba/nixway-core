import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { ClusterDetail, ClusterMember, WireGuardPeer, MeshEvent, Server } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { MeshHealthMatrix } from '@/components/mesh-health-matrix'
import { ObservabilityPanel } from '@/components/observability-panel'
import { Loader2, Trash2, Plus, Globe, Server as ServerIcon, Activity, Copy, Check } from 'lucide-react'

export const Route = createFileRoute('/_app/clusters_/$teamId/$clusterId')({
  component: ClusterDetailPage,
})

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

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500',
    online: 'bg-green-500',
    degraded: 'bg-yellow-500',
    error: 'bg-red-500',
    offline: 'bg-red-500',
  }
  const pulse = status === 'active' || status === 'online'
  const color = colors[status] ?? 'bg-gray-400'
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-60`} />}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  )
}

function statusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
    active: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    degraded: { variant: 'default', className: 'bg-yellow-500 hover:bg-yellow-500' },
    error: { variant: 'destructive' },
    online: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    offline: { variant: 'destructive' },
  }
  const cfg = map[status] ?? { variant: 'secondary' as const }
  return <Badge variant={cfg.variant} className={cfg.className}>{status}</Badge>
}

function eventIcon(eventType: string) {
  const icons: Record<string, string> = {
    member_added: '+',
    member_removed: '-',
    mesh_regenerated: '~',
    key_rotated: 'K',
    link_failure: '!',
    link_restored: 'v',
    dns_updated: 'D',
  }
  return icons[eventType] ?? 'o'
}

function CopyButton({ text, truncate = 16 }: { text: string; truncate?: number }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex items-center gap-1.5">
      <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
        {text.length > truncate ? `${text.slice(0, truncate)}…` : text}
      </code>
      <button onClick={copy} className="text-muted-foreground hover:text-foreground transition-colors">
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )
}

// Mesh connectivity stats
function meshStats(peers: WireGuardPeer[]) {
  const total = peers.length
  const active = peers.filter(p => p.status === 'active').length
  const pct = total > 0 ? Math.round((active / total) * 100) : 0
  return { total, active, pct }
}

function ClusterDetailPage() {
  const { teamId, clusterId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [selectedServerId, setSelectedServerId] = useState('')
  const [error, setError] = useState('')

  const { data: cluster, isLoading } = useQuery({
    queryKey: ['teams', teamId, 'clusters', clusterId],
    queryFn: () => api.get<ClusterDetail>(`/teams/${teamId}/clusters/${clusterId}`),
    refetchInterval: 15_000,
  })

  const { data: members = [] } = useQuery({
    queryKey: ['teams', teamId, 'clusters', clusterId, 'members'],
    queryFn: () => api.get<ClusterMember[]>(`/teams/${teamId}/clusters/${clusterId}/members`),
    refetchInterval: 15_000,
  })

  const { data: peers = [] } = useQuery({
    queryKey: ['teams', teamId, 'clusters', clusterId, 'mesh'],
    queryFn: () => api.get<WireGuardPeer[]>(`/teams/${teamId}/clusters/${clusterId}/mesh`),
    refetchInterval: 15_000,
  })

  const { data: events = [] } = useQuery({
    queryKey: ['teams', teamId, 'clusters', clusterId, 'events'],
    queryFn: () => api.get<MeshEvent[]>(`/teams/${teamId}/clusters/${clusterId}/events`),
  })

  const { data: servers = [] } = useQuery({
    queryKey: ['teams', teamId, 'servers'],
    queryFn: () => api.get<Server[]>(`/teams/${teamId}/servers`),
  })

  const addMember = useMutation({
    mutationFn: (serverId: string) =>
      api.post(`/teams/${teamId}/clusters/${clusterId}/members`, { server_id: serverId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'clusters', clusterId] })
      setAddMemberOpen(false)
      setSelectedServerId('')
      setError('')
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to add member')
    },
  })

  const removeMember = useMutation({
    mutationFn: (serverId: string) =>
      api.delete(`/teams/${teamId}/clusters/${clusterId}/members/${serverId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'clusters', clusterId] })
    },
  })

  const deleteCluster = useMutation({
    mutationFn: () => api.delete(`/teams/${teamId}/clusters/${clusterId}`),
    onSuccess: () => {
      navigate({ to: '/clusters/$teamId', params: { teamId } })
    },
  })

  if (isLoading || !cluster) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  const memberServerIds = new Set(members.map((m) => m.server_id))
  const availableServers = servers.filter((s) => !memberServerIds.has(s.id))
  const onlineCount = members.filter(m => m.server_status === 'online').length
  const offlineCount = members.length - onlineCount
  const mesh = meshStats(peers)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusDot status={cluster.status} />
          <div>
            <h1 className="text-2xl font-bold">{cluster.name}</h1>
            <p className="text-muted-foreground text-sm">{cluster.description || cluster.slug}</p>
          </div>
        </div>
        <Button variant="destructive" size="sm" onClick={() => deleteCluster.mutate()} disabled={deleteCluster.isPending}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete Cluster
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
          <TabsTrigger value="mesh">Mesh</TabsTrigger>
          <TabsTrigger value="observability">Observability</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {/* Health summary */}
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    cluster.status === 'active' ? 'bg-green-500/15 ring-2 ring-green-500/40' :
                    cluster.status === 'degraded' ? 'bg-yellow-500/15 ring-2 ring-yellow-500/40' :
                    'bg-red-500/15 ring-2 ring-red-500/40'
                  }`}>
                    <StatusDot status={cluster.status} />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Cluster Health</div>
                    <div className="mt-0.5">{statusBadge(cluster.status)}</div>
                  </div>
                </div>

                <div className="h-8 w-px bg-border hidden sm:block" />

                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Members</div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      <span className="font-medium">{onlineCount}</span>
                      <span className="text-muted-foreground">online</span>
                    </span>
                    {offlineCount > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-red-500" />
                        <span className="font-medium">{offlineCount}</span>
                        <span className="text-muted-foreground">offline</span>
                      </span>
                    )}
                  </div>
                </div>

                {peers.length > 0 && (
                  <>
                    <div className="h-8 w-px bg-border hidden sm:block" />
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Mesh Links</div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{mesh.active}/{mesh.total}</span>
                        <span className="text-muted-foreground">active</span>
                        <Badge
                          variant={mesh.pct === 100 ? 'default' : mesh.pct >= 50 ? 'secondary' : 'destructive'}
                          className={mesh.pct === 100 ? 'bg-green-500 hover:bg-green-500' : ''}
                        >
                          {mesh.pct}%
                        </Badge>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Status</CardTitle></CardHeader>
              <CardContent>{statusBadge(cluster.status)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">CIDR</CardTitle></CardHeader>
              <CardContent><code className="text-sm font-mono">{cluster.cidr}</code></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Region</CardTitle></CardHeader>
              <CardContent><span className="text-sm">{cluster.region || '—'}</span></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Members</CardTitle></CardHeader>
              <CardContent><span className="text-2xl font-bold">{cluster.member_count}</span></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Slug</dt><dd className="font-mono">{cluster.slug}</dd>
                <dt className="text-muted-foreground">DNS Zone</dt><dd><code className="font-mono">{cluster.slug}.internal</code></dd>
                <dt className="text-muted-foreground">Created</dt><dd>{new Date(cluster.created_at).toLocaleString()}</dd>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Members */}
        <TabsContent value="members" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAddMemberOpen(true)} disabled={availableServers.length === 0}>
              <Plus className="mr-2 h-4 w-4" /> Add Server
            </Button>
          </div>

          {members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <ServerIcon className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No servers in this cluster yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Server</TableHead>
                  <TableHead>WireGuard IP</TableHead>
                  <TableHead>Public Key</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusDot status={m.server_status} />
                        <span className="font-medium">{m.server_name}</span>
                      </div>
                    </TableCell>
                    <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{m.wireguard_ip}</code></TableCell>
                    <TableCell>
                      {m.wireguard_public_key ? (
                        <CopyButton text={m.wireguard_public_key} truncate={14} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono">{m.wireguard_endpoint}</TableCell>
                    <TableCell>{statusBadge(m.server_status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{relativeTime(m.joined_at)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeMember.mutate(m.server_id)}
                        disabled={removeMember.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Server to Cluster</DialogTitle>
                <DialogDescription>Select a server to add. A WireGuard IP will be auto-assigned.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Select value={selectedServerId} onValueChange={setSelectedServerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a server" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableServers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.public_ip})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setAddMemberOpen(false); setError('') }}>Cancel</Button>
                <Button onClick={() => addMember.mutate(selectedServerId)} disabled={!selectedServerId || addMember.isPending}>
                  {addMember.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Mesh */}
        <TabsContent value="mesh" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            {peers.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{mesh.active}</span>/{mesh.total} links active
                </span>
                <div className="h-2 w-32 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${mesh.pct === 100 ? 'bg-green-500' : mesh.pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${mesh.pct}%` }}
                  />
                </div>
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                api.post(`/teams/${teamId}/clusters/${clusterId}/mesh/regenerate`)
                  .then(() => queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'clusters', clusterId] }))
              }}
            >
              <Activity className="mr-2 h-4 w-4" /> Regenerate Mesh
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" /> Mesh Health Matrix
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MeshHealthMatrix peers={peers} />
            </CardContent>
          </Card>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-green-500" /> Active (excellent &lt;10ms / good &lt;50ms)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-yellow-500" /> Degraded (fair &lt;200ms)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-red-500" /> Failed / poor &gt;200ms</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-gray-300" /> Pending</span>
          </div>
        </TabsContent>

        <TabsContent value="observability" className="space-y-4 mt-4">
          <ObservabilityPanel
            teamId={teamId}
            scopeType="cluster"
            scopeId={clusterId}
            metrics={['cluster.server_cpu_percent', 'cluster.server_memory_percent', 'cluster.container_cpu_percent', 'cluster.container_memory_percent']}
          />
        </TabsContent>

        {/* Logs */}
        <TabsContent value="logs" className="space-y-4 mt-4">
          <MeshLogsPanel teamId={teamId} clusterId={clusterId} />
        </TabsContent>

        {/* Events */}
        <TabsContent value="events" className="space-y-4 mt-4">
          {events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Globe className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No mesh events recorded yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Event</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-center font-mono text-xs">{eventIcon(e.event_type)}</TableCell>
                    <TableCell>
                      <span className="font-medium">{e.event_type.replace(/_/g, ' ')}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(e.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

const eventColors: Record<string, string> = {
  error: 'text-red-500',
  warning: 'text-yellow-500',
  keygen_requested: 'text-blue-400',
  keygen_complete: 'text-green-400',
  config_pushed: 'text-blue-400',
  config_applied: 'text-green-500',
  mesh_regenerating: 'text-purple-400',
  mesh_regenerated: 'text-green-500',
  teardown_sent: 'text-orange-400',
  teardown_complete: 'text-orange-500',
  dns_updating: 'text-blue-400',
  dns_updated: 'text-green-400',
  info: 'text-muted-foreground',
  connected: 'text-muted-foreground',
}

function MeshLogsPanel({ teamId, clusterId }: { teamId: string; clusterId: string }) {
  const [logs, setLogs] = useState<{ event: string; message: string; time: string }[]>([])
  const [connected, setConnected] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const url = `/api/v1/teams/${teamId}/clusters/${clusterId}/mesh/logs`
    const source = new EventSource(url, { withCredentials: true })

    source.onopen = () => setConnected(true)

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setLogs((prev) => [...prev, { ...data, time: new Date().toLocaleTimeString() }])
      } catch {
        setLogs((prev) => [...prev, { event: 'info', message: event.data, time: new Date().toLocaleTimeString() }])
      }
    }

    source.onerror = () => {
      setConnected(false)
      source.close()
    }

    return () => {
      source.close()
      setConnected(false)
    }
  }, [teamId, clusterId])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4" />
          Mesh Operation Logs
          {connected ? (
            <Badge variant="default" className="bg-green-500 hover:bg-green-500 text-xs">Live</Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">Disconnected</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="bg-black rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-muted-foreground">Waiting for mesh operations... Add or remove servers to see logs here.</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="flex gap-2 py-0.5">
                <span className="text-muted-foreground shrink-0">{log.time}</span>
                <span className={`shrink-0 w-24 ${eventColors[log.event] ?? 'text-muted-foreground'}`}>
                  [{log.event}]
                </span>
                <span className="text-gray-300">{log.message}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </CardContent>
    </Card>
  )
}
