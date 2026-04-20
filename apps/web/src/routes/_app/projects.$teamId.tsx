import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { Project, Cluster } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, Plus, FolderOpen } from 'lucide-react'

export const Route = createFileRoute('/_app/projects/$teamId')({
  component: ProjectsPage,
})

function projectStatusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
    active: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    degraded: { variant: 'default', className: 'bg-yellow-500 hover:bg-yellow-500' },
    error: { variant: 'destructive' },
  }
  const cfg = map[status] ?? { variant: 'secondary' as const }
  return <Badge variant={cfg.variant} className={cfg.className}>{status}</Badge>
}

function ProjectsPage() {
  const { teamId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [clusterId, setClusterId] = useState('')

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['teams', teamId, 'projects'],
    queryFn: () => api.get<Project[]>(`/teams/${teamId}/projects`),
    refetchInterval: 30_000,
  })

  const { data: clusters = [] } = useQuery({
    queryKey: ['teams', teamId, 'clusters'],
    queryFn: () => api.get<Cluster[]>(`/teams/${teamId}/clusters`),
  })

  const createProject = useMutation({
    mutationFn: (data: { name: string; description: string; cluster_id: string }) =>
      api.post<Project>(`/teams/${teamId}/projects`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'projects'] })
      handleClose()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to create project')
    },
  })

  const handleClose = () => {
    setOpen(false)
    setName('')
    setDescription('')
    setClusterId('')
    setError('')
  }

  const handleSubmit = () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (!clusterId) { setError('Cluster is required'); return }
    createProject.mutate({ name, description, cluster_id: clusterId })
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
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground">Manage deployment projects and applications</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> New Project</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Project</DialogTitle>
              <DialogDescription>
                Create a project to group and deploy applications on a cluster.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
              </div>
              <div>
                <Label htmlFor="cluster">Cluster</Label>
                <Select value={clusterId} onValueChange={setClusterId}>
                  <SelectTrigger id="cluster">
                    <SelectValue placeholder="Select a cluster" />
                  </SelectTrigger>
                  <SelectContent>
                    {clusters.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={createProject.isPending}>
                {createProject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No projects yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Create a project to start deploying applications.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Cluster</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => (
              <TableRow
                key={p.id}
                className="cursor-pointer"
                onClick={() => navigate({ to: '/projects/$teamId/$projectId', params: { teamId, projectId: p.id } })}
              >
                <TableCell>
                  <div>
                    <span className="font-medium">{p.name}</span>
                    {p.description && <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{p.cluster_name || p.cluster_id}</TableCell>
                <TableCell>{projectStatusBadge(p.status)}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
