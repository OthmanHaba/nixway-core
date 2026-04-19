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
import { Loader2, Trash2, Plus } from 'lucide-react'

export const Route = createFileRoute('/_app/servers_/$teamId/$serverId')({
  component: ServerDetailPage,
})

interface ServerDetail extends Server {
  resources?: ServerResources
  tags?: ServerTag[]
  latest_job?: ProvisioningJob
}

const PROVISION_COMPONENTS = ['docker', 'traefik', 'nixpacks', 'buildpacks', 'railpack']

function statusBadge(status: string) {
  const map: Record<string, string> = {
    online: 'bg-green-500 hover:bg-green-500',
    degraded: 'bg-yellow-500 hover:bg-yellow-500',
    offline: '',
    provisioning: '',
  }
  const variant = status === 'offline' ? 'destructive' : status === 'online' || status === 'degraded' ? 'default' : 'secondary'
  return (
    <Badge variant={variant as 'default' | 'secondary' | 'destructive'} className={map[status] ?? ''}>
      {status}
    </Badge>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-2">
        <div
          className="bg-primary h-2 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
    </div>
  )
}

function ServerDetailPage() {
  const { teamId, serverId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selectedComponents, setSelectedComponents] = useState<string[]>([])
  const [sseUrl, setSseUrl] = useState<string | null>(null)
  const { messages: logMessages, connected: sseConnected, clear: clearLogs } = useSSE(sseUrl)
  const logRef = useRef<HTMLPreElement>(null)

  const [tagKey, setTagKey] = useState('')
  const [tagValue, setTagValue] = useState('')

  const { data: server, isLoading } = useQuery({
    queryKey: ['teams', teamId, 'servers', serverId],
    queryFn: () => api.get<ServerDetail>(`/teams/${teamId}/servers/${serverId}`),
  })

  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ['teams', teamId, 'servers', serverId, 'tags'],
    queryFn: () => api.get<ServerTag[]>(`/teams/${teamId}/servers/${serverId}/tags`),
  })

  const { data: latestJob } = useQuery({
    queryKey: ['teams', teamId, 'servers', serverId, 'latest-job'],
    queryFn: () => api.get<ProvisioningJob | null>(`/teams/${teamId}/servers/${serverId}/provision`),
  })

  // Auto-reconnect SSE if job is running when page loads
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

  // Auto-scroll logs
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{server.name}</h2>
          <p className="text-muted-foreground">{server.hostname}</p>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Server
        </Button>
      </div>

      {/* Delete confirmation */}
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
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="provisioning">Provisioning</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              { label: 'Status', value: statusBadge(server.status) },
              { label: 'Name', value: server.name },
              { label: 'Hostname', value: server.hostname },
              { label: 'Public IP', value: server.public_ip },
              { label: 'SSH Port', value: String(server.ssh_port) },
              { label: 'SSH User', value: server.ssh_user },
              { label: 'OS', value: server.os ? `${server.os} ${server.os_version ?? ''}`.trim() : '—' },
              { label: 'Arch', value: server.arch ?? '—' },
              { label: 'Agent ID', value: server.agent_id ?? '—' },
              { label: 'Last Seen', value: server.last_seen_at ? new Date(server.last_seen_at).toLocaleString() : 'Never' },
              { label: 'Created', value: new Date(server.created_at).toLocaleString() },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {typeof value === 'string' ? (
                    <span className="font-medium text-sm">{value}</span>
                  ) : value}
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
              <Card>
                <CardHeader><CardTitle>CPU</CardTitle></CardHeader>
                <CardContent className="space-y-1">
                  <p className="text-sm">{resources.cpu_model}</p>
                  <p className="text-sm text-muted-foreground">{resources.cpu_cores} core{resources.cpu_cores !== 1 ? 's' : ''}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Memory</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Used: {formatBytes(resources.memory_total - resources.memory_available)}</span>
                    <span>Total: {formatBytes(resources.memory_total)}</span>
                  </div>
                  <UsageBar used={resources.memory_total - resources.memory_available} total={resources.memory_total} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Disks</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mount Point</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Used</TableHead>
                        <TableHead>Usage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resources.disks.map((disk) => (
                        <TableRow key={disk.mount_point}>
                          <TableCell className="font-mono text-sm">{disk.mount_point}</TableCell>
                          <TableCell>{formatBytes(disk.total_bytes)}</TableCell>
                          <TableCell>{formatBytes(disk.used_bytes)}</TableCell>
                          <TableCell className="w-40">
                            <UsageBar used={disk.used_bytes} total={disk.total_bytes} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Network Interfaces</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {resources.network_interfaces.map((iface) => (
                      <div key={iface.name} className="flex items-start gap-4">
                        <span className="font-mono text-sm font-medium w-24">{iface.name}</span>
                        <span className="text-sm text-muted-foreground">{iface.ips.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
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
                  <Badge variant={
                    latestJob.status === 'completed' ? 'default' :
                    latestJob.status === 'failed' ? 'destructive' : 'secondary'
                  }>
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
                  {(() => {
                    const dbLogs = latestJob.logs || ''
                    const liveLogs = logMessages.join('\n')
                    const allLogs = liveLogs ? (dbLogs ? dbLogs + '\n' + liveLogs : liveLogs) : dbLogs
                    return allLogs || 'Waiting for logs...'
                  })()}
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
      </Tabs>
    </div>
  )
}
