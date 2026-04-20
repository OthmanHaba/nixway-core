import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { Cluster } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Loader2, Plus, Network } from 'lucide-react'

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500',
    degraded: 'bg-yellow-500',
    error: 'bg-red-500',
  }
  const pulse = status === 'active'
  const color = colors[status] ?? 'bg-gray-400'
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-60`} />}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
    </span>
  )
}

export const Route = createFileRoute('/_app/clusters/$teamId')({
  component: ClustersPage,
})

function clusterStatusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
    active: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    degraded: { variant: 'default', className: 'bg-yellow-500 hover:bg-yellow-500' },
    error: { variant: 'destructive' },
  }
  const cfg = map[status] ?? { variant: 'secondary' as const }
  return <Badge variant={cfg.variant} className={cfg.className}>{status}</Badge>
}

function ClustersPage() {
  const { teamId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [region, setRegion] = useState('')

  const { data: clusters = [], isLoading } = useQuery({
    queryKey: ['teams', teamId, 'clusters'],
    queryFn: () => api.get<Cluster[]>(`/teams/${teamId}/clusters`),
    refetchInterval: 15_000,
  })

  const createCluster = useMutation({
    mutationFn: (data: { name: string; description: string; region: string }) =>
      api.post<Cluster>(`/teams/${teamId}/clusters`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'clusters'] })
      handleClose()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to create cluster')
    },
  })

  const handleClose = () => {
    setOpen(false)
    setName('')
    setDescription('')
    setRegion('')
    setError('')
  }

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    createCluster.mutate({ name, description, region })
  }

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
          <h1 className="text-2xl font-bold">Clusters</h1>
          <p className="text-muted-foreground">Manage server clusters with private networking</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Create Cluster</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Cluster</DialogTitle>
              <DialogDescription>
                Create a new cluster. A private CIDR will be auto-allocated.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="production-us" />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="US East production cluster" />
              </div>
              <div>
                <Label htmlFor="region">Region</Label>
                <Input id="region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={createCluster.isPending}>
                {createCluster.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {clusters.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Network className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No clusters yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Create a cluster to group servers with private networking.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>CIDR</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clusters.map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => navigate({ to: '/clusters/$teamId/$clusterId', params: { teamId, clusterId: c.id } })}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <StatusDot status={c.status} />
                    <span className="font-medium">{c.name}</span>
                  </div>
                </TableCell>
                <TableCell>{c.region || '—'}</TableCell>
                <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{c.cidr}</code></TableCell>
                <TableCell>{clusterStatusBadge(c.status)}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
