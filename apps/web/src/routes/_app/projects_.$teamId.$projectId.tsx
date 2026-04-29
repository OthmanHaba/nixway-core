import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { Project, Environment, App, GitHubApp, GitHubInstallation, GitHubRepository } from '@/lib/types'
import { ObservabilityPanel } from '@/components/observability-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, Plus, Layers, GitBranch, Box, Database as DatabaseIcon } from 'lucide-react'

export const Route = createFileRoute('/_app/projects_/$teamId/$projectId')({
  component: ProjectDetailPage,
})

function statusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
    active: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    healthy: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    degraded: { variant: 'default', className: 'bg-yellow-500 hover:bg-yellow-500' },
    error: { variant: 'destructive' },
    failed: { variant: 'destructive' },
  }
  const cfg = map[status] ?? { variant: 'secondary' as const }
  return <Badge variant={cfg.variant} className={cfg.className}>{status}</Badge>
}

function RepoSearchSelect({ repos, value, onSelect }: {
  repos: GitHubRepository[]
  value: string
  onSelect: (v: string) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = repos.filter(r =>
    r.full_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="relative">
      <Input
        placeholder="Search repositories..."
        value={value || search}
        onChange={(e) => {
          setSearch(e.target.value)
          if (value) onSelect('')
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No repos found</div>
          ) : (
            filtered.map((repo) => (
              <div
                key={repo.id}
                className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-accent ${
                  value === repo.full_name ? 'bg-accent' : ''
                }`}
                onClick={() => {
                  onSelect(repo.full_name)
                  setSearch('')
                  setOpen(false)
                }}
              >
                <span>{repo.full_name}</span>
                <span className="text-xs text-muted-foreground">
                  {repo.private ? '🔒 ' : ''}{repo.default_branch}
                </span>
              </div>
            ))
          )}
        </div>
      )}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  )
}

function ProjectDetailPage() {
  const { teamId, projectId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // New environment dialog
  const [envOpen, setEnvOpen] = useState(false)
  const [envName, setEnvName] = useState('')
  const [envIsProduction, setEnvIsProduction] = useState('false')
  const [envError, setEnvError] = useState('')

  // New app dialog
  const [appOpen, setAppOpen] = useState(false)
  const [appName, setAppName] = useState('')
  const [appSourceType, setAppSourceType] = useState<'github' | 'docker_image'>('github')
  const [appInstallationId, setAppInstallationId] = useState('')
  const [appRepo, setAppRepo] = useState('')
  const [appBranch, setAppBranch] = useState('main')
  const [appDockerImage, setAppDockerImage] = useState('')
  const [appBuilder, setAppBuilder] = useState('auto')
  const [appPort, setAppPort] = useState('3000')
  const [appHealthPath, setAppHealthPath] = useState('/')
  const [appError, setAppError] = useState('')

  const { data: project, isLoading } = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => api.get<Project>(`/teams/${teamId}/projects/${projectId}`),
  })

  const { data: environments = [] } = useQuery({
    queryKey: ['projects', projectId, 'environments'],
    queryFn: () => api.get<Environment[]>(`/projects/${projectId}/environments`),
  })

  const { data: apps = [] } = useQuery({
    queryKey: ['projects', projectId, 'apps'],
    queryFn: () => api.get<App[]>(`/projects/${projectId}/apps`),
    refetchInterval: 30_000,
  })

  // GitHub App for this team (to get install link)
  const { data: githubApp } = useQuery({
    queryKey: ['teams', teamId, 'github', 'app'],
    queryFn: () => api.get<GitHubApp>(`/teams/${teamId}/github/app`).catch(() => null),
    enabled: appOpen && appSourceType === 'github',
  })

  // GitHub installations for this team (auto-sync from GitHub on open)
  const { data: installations = [] } = useQuery({
    queryKey: ['teams', teamId, 'github', 'installations'],
    queryFn: async () => {
      // Sync first, then fetch
      await api.post(`/teams/${teamId}/github/installations/sync`).catch(() => {})
      return api.get<GitHubInstallation[]>(`/teams/${teamId}/github/installations`)
    },
    enabled: appOpen && appSourceType === 'github',
  })

  // Repos for selected installation
  const { data: repos = [], isLoading: reposLoading } = useQuery({
    queryKey: ['teams', teamId, 'github', 'installations', appInstallationId, 'repos'],
    queryFn: () => api.get<GitHubRepository[]>(`/teams/${teamId}/github/installations/${appInstallationId}/repos`),
    enabled: !!appInstallationId,
  })

  const createEnvironment = useMutation({
    mutationFn: (data: { name: string; is_production: boolean }) =>
      api.post<Environment>(`/projects/${projectId}/environments`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'environments'] })
      setEnvOpen(false)
      setEnvName('')
      setEnvIsProduction('false')
      setEnvError('')
    },
    onError: (err) => {
      setEnvError(err instanceof ApiError ? err.message : 'Failed to create environment')
    },
  })

  const createApp = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post<App>(`/projects/${projectId}/apps`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'apps'] })
      handleCloseApp()
    },
    onError: (err) => {
      setAppError(err instanceof ApiError ? err.message : 'Failed to create app')
    },
  })

  const handleCloseApp = () => {
    setAppOpen(false)
    setAppName('')
    setAppSourceType('github')
    setAppInstallationId('')
    setAppRepo('')
    setAppBranch('main')
    setAppDockerImage('')
    setAppBuilder('auto')
    setAppPort('3000')
    setAppHealthPath('/')
    setAppError('')
  }

  const handleSubmitApp = () => {
    if (!appName.trim()) { setAppError('Name is required'); return }
    if (appSourceType === 'github' && !appRepo) { setAppError('Select a repository'); return }
    if (appSourceType === 'github' && !appInstallationId) { setAppError('Select a GitHub installation'); return }
    if (appSourceType === 'docker_image' && !appDockerImage.trim()) { setAppError('Docker image is required'); return }

    const payload: Record<string, unknown> = {
      name: appName,
      source_type: appSourceType,
      builder: appBuilder,
      port: parseInt(appPort, 10) || 3000,
      health_check_path: appHealthPath,
    }
    if (appSourceType === 'github') {
      // Find the DB UUID for the selected installation (appInstallationId is the numeric GitHub ID)
      const selectedInst = installations.find(i => String(i.installation_id) === appInstallationId)
      if (selectedInst) {
        payload.github_installation_id = selectedInst.id
      }
      payload.repo_full_name = appRepo
      payload.branch = appBranch
    } else {
      payload.docker_image = appDockerImage
    }
    createApp.mutate(payload)
  }

  if (isLoading || !project) {
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
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-muted-foreground text-sm">{project.description || project.slug}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <Link to="/databases/$teamId/$projectId" params={{ teamId, projectId }}>
              <DatabaseIcon className="mr-2 h-4 w-4" /> Databases
            </Link>
          </Button>
          {statusBadge(project.status)}
        </div>
      </div>

      {/* Project info */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Cluster</dt><dd>{project.cluster_name || project.cluster_id}</dd>
            <dt className="text-muted-foreground">Slug</dt><dd className="font-mono">{project.slug}</dd>
            <dt className="text-muted-foreground">Status</dt><dd>{statusBadge(project.status)}</dd>
            <dt className="text-muted-foreground">Created</dt><dd>{new Date(project.created_at).toLocaleString()}</dd>
          </dl>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Observability</h2>
        <ObservabilityPanel
          teamId={teamId}
          scopeType="project"
          scopeId={projectId}
          metrics={['project.container_cpu_percent', 'project.container_memory_percent', 'project.container_network_rx_bytes', 'project.container_network_tx_bytes']}
        />
      </section>

      {/* Environments */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5" /> Environments
          </h2>
          <Button size="sm" variant="outline" onClick={() => setEnvOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Environment
          </Button>
        </div>

        {environments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No environments yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {environments.map((env) => (
              <div key={env.id} className="flex items-center gap-2 border rounded-md px-3 py-1.5 text-sm">
                <span className="font-medium">{env.name}</span>
                {env.is_production && <Badge variant="default" className="bg-orange-500 hover:bg-orange-500 text-xs">production</Badge>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Apps */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Box className="h-5 w-5" /> Apps
          </h2>
          <Button size="sm" onClick={() => setAppOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New App
          </Button>
        </div>

        {apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Box className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No apps yet. Create one to start deploying.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Builder</TableHead>
                <TableHead>Port</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((app) => (
                <TableRow
                  key={app.id}
                  className="cursor-pointer"
                  onClick={() => navigate({ to: '/apps/$appId', params: { appId: app.id } })}
                >
                  <TableCell className="font-medium">{app.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      {app.source_type === 'github' ? (
                        <>
                          <GitBranch className="h-3.5 w-3.5" />
                          <span>{app.repo_full_name || '—'}</span>
                          {app.branch && <span className="text-xs">({app.branch})</span>}
                        </>
                      ) : (
                        <>
                          <Box className="h-3.5 w-3.5" />
                          <span>{app.docker_image || '—'}</span>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{app.builder}</TableCell>
                  <TableCell className="text-muted-foreground">{app.port}</TableCell>
                  <TableCell>{statusBadge(app.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* New Environment Dialog */}
      <Dialog open={envOpen} onOpenChange={setEnvOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Environment</DialogTitle>
            <DialogDescription>Add an environment like staging or production.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {envError && <p className="text-sm text-red-500">{envError}</p>}
            <div>
              <Label htmlFor="env-name">Name</Label>
              <Input id="env-name" value={envName} onChange={(e) => setEnvName(e.target.value)} placeholder="staging" />
            </div>
            <div>
              <Label htmlFor="env-type">Type</Label>
              <Select value={envIsProduction} onValueChange={setEnvIsProduction}>
                <SelectTrigger id="env-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">Development / Staging</SelectItem>
                  <SelectItem value="true">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEnvOpen(false); setEnvError('') }}>Cancel</Button>
            <Button
              onClick={() => {
                if (!envName.trim()) { setEnvError('Name is required'); return }
                createEnvironment.mutate({ name: envName, is_production: envIsProduction === 'true' })
              }}
              disabled={createEnvironment.isPending}
            >
              {createEnvironment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New App Dialog */}
      <Dialog open={appOpen} onOpenChange={(v) => { if (!v) handleCloseApp(); else setAppOpen(true) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New App</DialogTitle>
            <DialogDescription>Configure your application source and build settings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {appError && <p className="text-sm text-red-500">{appError}</p>}
            <div>
              <Label htmlFor="app-name">Name</Label>
              <Input id="app-name" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="my-app" />
            </div>
            <div>
              <Label htmlFor="source-type">Source Type</Label>
              <Select value={appSourceType} onValueChange={(v) => setAppSourceType(v as 'github' | 'docker_image')}>
                <SelectTrigger id="source-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="github">GitHub Repository</SelectItem>
                  <SelectItem value="docker_image">Docker Image</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {appSourceType === 'github' ? (
              <>
                <div>
                  <Label htmlFor="app-installation">GitHub Account</Label>
                  {installations.length === 0 ? (
                    <div className="text-sm text-muted-foreground mt-1 space-y-2">
                      {!githubApp ? (
                        <p>
                          No GitHub App connected. Go to{' '}
                          <span className="underline cursor-pointer text-blue-500" onClick={() => navigate({ to: '/settings/$teamId', params: { teamId } })}>
                            Settings → GitHub
                          </span>{' '}
                          to create one first.
                        </p>
                      ) : (
                        <>
                          <p>GitHub App "{githubApp.app_name}" is connected but not installed on any account.</p>
                          <a
                            href={`https://github.com/apps/${githubApp.app_slug}/installations/new`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-500 hover:underline"
                          >
                            Install on GitHub →
                          </a>
                        </>
                      )}
                    </div>
                  ) : (
                    <Select value={appInstallationId} onValueChange={(v) => { setAppInstallationId(v); setAppRepo(''); setAppBranch('main') }}>
                      <SelectTrigger id="app-installation">
                        <SelectValue placeholder="Select GitHub account" />
                      </SelectTrigger>
                      <SelectContent>
                        {installations.map((inst) => (
                          <SelectItem key={inst.id} value={String(inst.installation_id)}>
                            {inst.account_login} ({inst.account_type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {appInstallationId && (
                  <div>
                    <Label htmlFor="app-repo">Repository</Label>
                    {reposLoading ? (
                      <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading repositories...
                      </div>
                    ) : repos.length === 0 ? (
                      <p className="text-sm text-muted-foreground mt-1">No repositories found for this installation.</p>
                    ) : (
                      <RepoSearchSelect
                        repos={repos}
                        value={appRepo}
                        onSelect={(v) => {
                          setAppRepo(v)
                          const selected = repos.find(r => r.full_name === v)
                          if (selected) setAppBranch(selected.default_branch)
                        }}
                      />
                    )}
                  </div>
                )}
                {appRepo && (
                  <div>
                    <Label htmlFor="app-branch">Branch</Label>
                    <Input id="app-branch" value={appBranch} onChange={(e) => setAppBranch(e.target.value)} placeholder="main" />
                  </div>
                )}
              </>
            ) : (
              <div>
                <Label htmlFor="app-image">Docker Image</Label>
                <Input id="app-image" value={appDockerImage} onChange={(e) => setAppDockerImage(e.target.value)} placeholder="nginx:latest" />
              </div>
            )}

            <div>
              <Label htmlFor="app-builder">Builder</Label>
              <Select value={appBuilder} onValueChange={setAppBuilder}>
                <SelectTrigger id="app-builder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  <SelectItem value="dockerfile">Dockerfile</SelectItem>
                  <SelectItem value="nixpacks">Nixpacks</SelectItem>
                  <SelectItem value="buildpacks">Buildpacks</SelectItem>
                  <SelectItem value="railpack">Railpack</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="app-port">Port</Label>
                <Input id="app-port" type="number" value={appPort} onChange={(e) => setAppPort(e.target.value)} placeholder="3000" />
              </div>
              <div>
                <Label htmlFor="app-health">Health Check Path</Label>
                <Input id="app-health" value={appHealthPath} onChange={(e) => setAppHealthPath(e.target.value)} placeholder="/" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseApp}>Cancel</Button>
            <Button onClick={handleSubmitApp} disabled={createApp.isPending}>
              {createApp.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create App
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
