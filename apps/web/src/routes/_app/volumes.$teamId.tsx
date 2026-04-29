import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { Cluster, Server, Volume } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Loader2, Plus, HardDrive } from 'lucide-react'

export const Route = createFileRoute('/_app/volumes/$teamId')({
  component: VolumesPage,
})

function statusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
    attached: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    unattached: { variant: 'secondary' },
    moving: { variant: 'default', className: 'bg-blue-500 hover:bg-blue-500' },
    snapshotting: { variant: 'default', className: 'bg-yellow-500 hover:bg-yellow-500' },
    resizing: { variant: 'default', className: 'bg-yellow-500 hover:bg-yellow-500' },
    error: { variant: 'destructive' },
  }
  const cfg = map[status] ?? { variant: 'secondary' as const }
  return <Badge variant={cfg.variant} className={cfg.className}>{status}</Badge>
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

function VolumesPage() {
  const { teamId } = Route.useParams()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [sizeGB, setSizeGB] = useState('10')
  const [filesystem, setFilesystem] = useState('ext4')
  const [clusterId, setClusterId] = useState('')
  const [serverId, setServerId] = useState('')

  const { data: volumes = [], isLoading } = useQuery({
    queryKey: ['teams', teamId, 'volumes'],
    queryFn: () => api.get<Volume[]>(`/teams/${teamId}/volumes`),
    refetchInterval: 15_000,
  })

  const { data: clusters = [] } = useQuery({
    queryKey: ['teams', teamId, 'clusters'],
    queryFn: () => api.get<Cluster[]>(`/teams/${teamId}/clusters`),
  })

  const { data: servers = [] } = useQuery({
    queryKey: ['teams', teamId, 'servers'],
    queryFn: () => api.get<Server[]>(`/teams/${teamId}/servers`),
  })

  const createVolume = useMutation({
    mutationFn: (data: { cluster_id: string; server_id: string; name: string; size_gb: number; filesystem: string }) =>
      api.post<Volume>(`/teams/${teamId}/volumes`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'volumes'] })
      handleClose()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to create volume')
    },
  })

  const handleClose = () => {
    setOpen(false)
    setName('')
    setSizeGB('10')
    setFilesystem('ext4')
    setClusterId('')
    setServerId('')
    setError('')
  }

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!clusterId || !serverId) {
      setError('Cluster and server are required')
      return
    }
    const size = parseInt(sizeGB, 10)
    if (!size || size <= 0) {
      setError('Size must be a positive number')
      return
    }
    createVolume.mutate({
      cluster_id: clusterId,
      server_id: serverId,
      name,
      size_gb: size,
      filesystem,
    })
  }

  const serverName = (id: string) => servers.find((s) => s.id === id)?.name ?? id.slice(0, 8)
  const clusterName = (id: string) => clusters.find((c) => c.id === id)?.name ?? id.slice(0, 8)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Volumes</h1>
          <p className="text-muted-foreground">Persistent storage attached to your servers via bind mounts</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Create Volume</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Volume</DialogTitle>
              <DialogDescription>
                Create a new bind-mount volume on a specific server. Soft quotas are enforced.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="postgres-data" />
              </div>
              <div>
                <Label htmlFor="size">Size (GB)</Label>
                <Input id="size" type="number" min="1" value={sizeGB} onChange={(e) => setSizeGB(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="fs">Filesystem</Label>
                <Input id="fs" value={filesystem} onChange={(e) => setFilesystem(e.target.value)} placeholder="ext4" />
              </div>
              <div>
                <Label htmlFor="cluster">Cluster</Label>
                <select
                  id="cluster"
                  value={clusterId}
                  onChange={(e) => setClusterId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select a cluster</option>
                  {clusters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="server">Server</Label>
                <select
                  id="server"
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select a server</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={createVolume.isPending}>
                {createVolume.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {volumes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <HardDrive className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No volumes yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Create a volume to give your apps persistent storage.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Used</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Server</TableHead>
              <TableHead>Cluster</TableHead>
              <TableHead>Mount</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {volumes.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">{v.name}</TableCell>
                <TableCell>{v.size_gb} GB</TableCell>
                <TableCell className="text-muted-foreground">{formatBytes(v.used_bytes)}</TableCell>
                <TableCell>{statusBadge(v.status)}</TableCell>
                <TableCell>{serverName(v.server_id)}</TableCell>
                <TableCell>{clusterName(v.cluster_id)}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {v.mount_path ? `${v.mount_path} → ${v.container_name ?? ''}` : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
