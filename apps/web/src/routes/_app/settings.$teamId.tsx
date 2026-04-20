import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { GitHubApp, GitHubInstallation, GitHubRepository, RegistryCredential, Secret } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import {
  Loader2,
  Plus,
  Trash2,
  GitBranch,
  Check,
  Minus,
  Eye,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Container,
  ExternalLink,
} from 'lucide-react'

export const Route = createFileRoute('/_app/settings/$teamId')({
  component: SettingsPage,
})

// ---------------------------------------------------------------------------
// GitHub Tab
// ---------------------------------------------------------------------------

function GitHubTab({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [expandedInstallation, setExpandedInstallation] = useState<string | null>(null)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const { data: app, isLoading: appLoading } = useQuery({
    queryKey: ['teams', teamId, 'github', 'app'],
    queryFn: () => api.get<GitHubApp>(`/teams/${teamId}/github/app`).catch((err) => {
      if (err instanceof ApiError && err.message?.toLowerCase().includes('not found')) return null
      throw err
    }),
    retry: false,
  })

  const { data: installations = [], isLoading: installationsLoading } = useQuery({
    queryKey: ['teams', teamId, 'github', 'installations'],
    queryFn: () => api.get<GitHubInstallation[]>(`/teams/${teamId}/github/installations`),
    enabled: !!app,
  })

  const connectMutation = useMutation({
    mutationFn: () => api.post<{ manifest: unknown; redirect_url: string }>(`/teams/${teamId}/github/manifest`, {}),
    onSuccess: (data) => {
      localStorage.setItem('nixway_github_team_id', teamId)
      // Use a hidden form POST to GitHub — this auto-creates the app without user filling any fields
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = 'https://github.com/settings/apps/new'
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = 'manifest'
      input.value = JSON.stringify(data.manifest)
      form.appendChild(input)
      document.body.appendChild(form)
      form.submit()
    },
    onError: (err) => {
      toast({
        title: 'Failed to start GitHub connection',
        description: err instanceof ApiError ? err.message : 'Unknown error',
      })
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: () => api.delete(`/teams/${teamId}/github/app`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'github'] })
      setDisconnectOpen(false)
      toast({ title: 'GitHub App disconnected' })
    },
    onError: (err) => {
      toast({
        title: 'Failed to disconnect',
        description: err instanceof ApiError ? err.message : 'Unknown error',
      })
    },
  })

  if (appLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!app) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Connect GitHub
          </CardTitle>
          <CardDescription>
            Connect a GitHub App to enable repository access for deployments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
            {connectMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <GitBranch className="mr-2 h-4 w-4" />
            )}
            Connect GitHub App
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* App info card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                {app.app_name}
              </CardTitle>
              <CardDescription>
                App ID: {app.app_id} &middot; Slug: {app.app_slug}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={app.html_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  View on GitHub
                </a>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDisconnectOpen(true)}
              >
                Disconnect
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Installations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Installations</h3>
          {app && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                api.post(`/teams/${teamId}/github/installations/sync`).then(() => {
                  queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'github', 'installations'] })
                  toast({ title: 'Installations synced from GitHub' })
                }).catch(() => {
                  toast({ title: 'Sync failed', variant: 'destructive' })
                })
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync from GitHub
            </Button>
          )}
        </div>
        {installationsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : installations.length === 0 ? (
          <div className="text-center py-8 space-y-3">
            <p className="text-muted-foreground">
              No installations found. Install the GitHub App on your account or organization to access repositories.
            </p>
            {app && (
              <a
                href={`https://github.com/apps/${app.app_slug}/installations/new`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Install App on GitHub
                </Button>
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {installations.map((inst) => (
              <InstallationRow
                key={inst.id}
                teamId={teamId}
                installation={inst}
                expanded={expandedInstallation === inst.id}
                onToggle={() =>
                  setExpandedInstallation(expandedInstallation === inst.id ? null : inst.id)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Disconnect confirm dialog */}
      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect GitHub App</DialogTitle>
            <DialogDescription>
              This will remove the GitHub App connection. Deployments using GitHub repositories may
              stop working. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate()}
            >
              {disconnectMutation.isPending ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InstallationRow({
  teamId,
  installation,
  expanded,
  onToggle,
}: {
  teamId: string
  installation: GitHubInstallation
  expanded: boolean
  onToggle: () => void
}) {
  const { data: repos = [], isLoading } = useQuery({
    queryKey: ['teams', teamId, 'github', 'installations', installation.id, 'repos'],
    queryFn: () =>
      api.get<GitHubRepository[]>(
        `/teams/${teamId}/github/installations/${installation.installation_id}/repos`,
      ),
    enabled: expanded,
  })

  return (
    <div className="rounded-md border">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">{installation.account_login}</span>
          <Badge variant="secondary">{installation.account_type}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onToggle() }}>
          Browse Repos
        </Button>
      </div>

      {expanded && (
        <div className="border-t px-4 py-3">
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : repos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No repositories found.</p>
          ) : (
            <div className="space-y-1">
              {repos.map((repo) => (
                <div
                  key={repo.id}
                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{repo.name}</span>
                    {repo.private && (
                      <Badge variant="outline" className="text-xs">private</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{repo.default_branch}</span>
                  </div>
                  <a
                    href={repo.clone_url.replace('.git', '')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Registries Tab
// ---------------------------------------------------------------------------

type RegistryType = 'dockerhub' | 'ghcr' | 'ecr' | 'generic'

const REGISTRY_TYPE_LABELS: Record<RegistryType, string> = {
  dockerhub: 'Docker Hub',
  ghcr: 'GHCR',
  ecr: 'ECR',
  generic: 'Generic',
}

function RegistriesTab({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [addOpen, setAddOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [registryType, setRegistryType] = useState<RegistryType>('dockerhub')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [registryUrl, setRegistryUrl] = useState('')
  const [region, setRegion] = useState('')
  const [awsAccessKeyId, setAwsAccessKeyId] = useState('')
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState('')
  const [formError, setFormError] = useState('')

  const { data: registries = [], isLoading } = useQuery({
    queryKey: ['teams', teamId, 'registries'],
    queryFn: () => api.get<RegistryCredential[]>(`/teams/${teamId}/registries`),
  })

  const addMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      api.post<RegistryCredential>(`/teams/${teamId}/registries`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'registries'] })
      handleCloseAdd()
      toast({ title: 'Registry added', description: 'The registry credential has been saved.' })
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : 'Failed to add registry')
    },
  })

  const validateMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/teams/${teamId}/registries/${id}/validate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'registries'] })
      toast({ title: 'Registry validated', description: 'Credentials are valid.' })
    },
    onError: (err) => {
      toast({
        title: 'Validation failed',
        description: err instanceof ApiError ? err.message : 'Could not validate credentials',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/teams/${teamId}/registries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'registries'] })
      setDeleteId(null)
      toast({ title: 'Registry deleted' })
    },
    onError: (err) => {
      toast({
        title: 'Failed to delete',
        description: err instanceof ApiError ? err.message : 'Unknown error',
      })
    },
  })

  const handleCloseAdd = () => {
    setAddOpen(false)
    setName('')
    setRegistryType('dockerhub')
    setUsername('')
    setPassword('')
    setRegistryUrl('')
    setRegion('')
    setAwsAccessKeyId('')
    setAwsSecretAccessKey('')
    setFormError('')
  }

  const handleSubmitAdd = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    const payload: Record<string, string> = {
      name,
      registry_type: registryType,
      username,
      password,
    }
    if (registryType === 'ecr') {
      payload.region = region
      payload.aws_access_key_id = awsAccessKeyId
      payload.aws_secret_access_key = awsSecretAccessKey
    }
    if (registryType === 'generic') {
      payload.registry_url = registryUrl
    }
    addMutation.mutate(payload)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Container Registries</h3>
          <p className="text-sm text-muted-foreground">Manage credentials for private container registries.</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Registry
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : registries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Container className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No registries yet. Add one to pull private images.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>URL / Account</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Validated</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registries.map((reg) => (
                <TableRow key={reg.id}>
                  <TableCell className="font-medium">{reg.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {REGISTRY_TYPE_LABELS[reg.registry_type as RegistryType] ?? reg.registry_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {reg.registry_url || '—'}
                  </TableCell>
                  <TableCell className="text-sm">{reg.username}</TableCell>
                  <TableCell>
                    {reg.validated_at ? (
                      <span className="flex items-center gap-1 text-green-600">
                        <Check className="h-4 w-4" />
                        <span className="text-xs">
                          {new Date(reg.validated_at).toLocaleDateString()}
                        </span>
                      </span>
                    ) : (
                      <Minus className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Validate"
                        disabled={validateMutation.isPending}
                        onClick={() => validateMutation.mutate(reg.id)}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() => setDeleteId(reg.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={(v) => { if (!v) handleCloseAdd(); else setAddOpen(true) }}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleSubmitAdd}>
            <DialogHeader>
              <DialogTitle>Add Registry</DialogTitle>
              <DialogDescription>Add credentials for a private container registry.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              {formError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>
              )}
              <div className="space-y-2">
                <Label htmlFor="reg-name">Name</Label>
                <Input
                  id="reg-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., production-ecr"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-type">Type</Label>
                <Select value={registryType} onValueChange={(v) => setRegistryType(v as RegistryType)}>
                  <SelectTrigger id="reg-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dockerhub">Docker Hub</SelectItem>
                    <SelectItem value="ghcr">GHCR</SelectItem>
                    <SelectItem value="ecr">ECR</SelectItem>
                    <SelectItem value="generic">Generic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {registryType === 'generic' && (
                <div className="space-y-2">
                  <Label htmlFor="reg-url">Registry URL</Label>
                  <Input
                    id="reg-url"
                    value={registryUrl}
                    onChange={(e) => setRegistryUrl(e.target.value)}
                    placeholder="registry.example.com"
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="reg-username">Username</Label>
                <Input
                  id="reg-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={registryType === 'ecr' ? 'AWS IAM username' : 'username'}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-password">Password</Label>
                <Input
                  id="reg-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              {registryType === 'ecr' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="reg-region">Region</Label>
                    <Input
                      id="reg-region"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      placeholder="us-east-1"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-access-key">AWS Access Key ID</Label>
                    <Input
                      id="reg-access-key"
                      value={awsAccessKeyId}
                      onChange={(e) => setAwsAccessKeyId(e.target.value)}
                      placeholder="AKIAIOSFODNN7EXAMPLE"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-secret-key">AWS Secret Access Key</Label>
                    <Input
                      id="reg-secret-key"
                      type="password"
                      value={awsSecretAccessKey}
                      onChange={(e) => setAwsSecretAccessKey(e.target.value)}
                      placeholder="••••••••"
                      required
                    />
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCloseAdd}>Cancel</Button>
              <Button type="submit" disabled={addMutation.isPending}>
                {addMutation.isPending ? 'Adding...' : 'Add Registry'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Registry</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this registry credential? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Secrets Tab
// ---------------------------------------------------------------------------

const ENVIRONMENTS = ['production', 'staging', 'preview']

function SecretsTab({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [environment, setEnvironment] = useState('production')
  const [addOpen, setAddOpen] = useState(false)
  const [updateSecret, setUpdateSecret] = useState<Secret | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({})
  const [revealModalSecret, setRevealModalSecret] = useState<{ id: string; value: string } | null>(null)

  // Add form
  const [addEnv, setAddEnv] = useState('production')
  const [addKey, setAddKey] = useState('')
  const [addValue, setAddValue] = useState('')
  const [addError, setAddError] = useState('')

  // Update form
  const [updateValue, setUpdateValue] = useState('')
  const [updateError, setUpdateError] = useState('')

  const { data: secrets = [], isLoading } = useQuery({
    queryKey: ['teams', teamId, 'secrets', environment],
    queryFn: () => api.get<Secret[]>(`/teams/${teamId}/secrets?environment=${encodeURIComponent(environment)}`),
  })

  const addMutation = useMutation({
    mutationFn: (data: { environment: string; key: string; value: string }) =>
      api.post<Secret>(`/teams/${teamId}/secrets`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'secrets'] })
      handleCloseAdd()
      toast({ title: 'Secret added' })
    },
    onError: (err) => {
      setAddError(err instanceof ApiError ? err.message : 'Failed to add secret')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.put<Secret>(`/teams/${teamId}/secrets/${id}`, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'secrets'] })
      setUpdateSecret(null)
      setUpdateValue('')
      setUpdateError('')
      toast({ title: 'Secret updated' })
    },
    onError: (err) => {
      setUpdateError(err instanceof ApiError ? err.message : 'Failed to update secret')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/teams/${teamId}/secrets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'secrets'] })
      setDeleteId(null)
      toast({ title: 'Secret deleted' })
    },
    onError: (err) => {
      toast({
        title: 'Failed to delete',
        description: err instanceof ApiError ? err.message : 'Unknown error',
      })
    },
  })

  const revealMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ value: string }>(`/teams/${teamId}/secrets/${id}/reveal`, {}),
    onSuccess: (data, id) => {
      setRevealedValues((prev) => ({ ...prev, [id]: data.value }))
      setRevealModalSecret({ id, value: data.value })
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'secrets'] })
    },
    onError: (err) => {
      toast({
        title: 'Failed to reveal secret',
        description: err instanceof ApiError ? err.message : 'Unknown error',
      })
    },
  })

  const handleCloseAdd = () => {
    setAddOpen(false)
    setAddKey('')
    setAddValue('')
    setAddEnv('production')
    setAddError('')
  }

  const handleSubmitAdd = (e: React.FormEvent) => {
    e.preventDefault()
    setAddError('')
    addMutation.mutate({ environment: addEnv, key: addKey, value: addValue })
  }

  const handleSubmitUpdate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!updateSecret) return
    setUpdateError('')
    updateMutation.mutate({ id: updateSecret.id, value: updateValue })
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: 'Copied to clipboard' })
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Secrets</h3>
          <p className="text-sm text-muted-foreground">Manage environment secrets for deployments.</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Secret
        </Button>
      </div>

      {/* Environment filter */}
      <div className="flex items-center gap-3">
        <Label htmlFor="env-filter" className="shrink-0">Environment</Label>
        <Select value={environment} onValueChange={setEnvironment}>
          <SelectTrigger id="env-filter" className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENVIRONMENTS.map((env) => (
              <SelectItem key={env} value={env}>{env}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : secrets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <KeyRound className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No secrets in {environment}. Add one to get started.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Revealed</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {secrets.map((secret) => {
                const alreadyRevealed = !!secret.revealed_at || !!revealedValues[secret.id]
                return (
                  <TableRow key={secret.id}>
                    <TableCell className="font-mono text-sm font-medium">{secret.key}</TableCell>
                    <TableCell>
                      <Badge variant="outline">v{secret.version}</Badge>
                    </TableCell>
                    <TableCell>
                      {alreadyRevealed ? (
                        <Badge variant="secondary">Revealed</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">No</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(secret.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Reveal"
                          disabled={alreadyRevealed || revealMutation.isPending}
                          onClick={() => revealMutation.mutate(secret.id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Update"
                          onClick={() => {
                            setUpdateSecret(secret)
                            setUpdateValue('')
                            setUpdateError('')
                          }}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          onClick={() => setDeleteId(secret.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Secret dialog */}
      <Dialog open={addOpen} onOpenChange={(v) => { if (!v) handleCloseAdd(); else setAddOpen(true) }}>
        <DialogContent>
          <form onSubmit={handleSubmitAdd}>
            <DialogHeader>
              <DialogTitle>Add Secret</DialogTitle>
              <DialogDescription>Add a new secret for a specific environment.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              {addError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{addError}</div>
              )}
              <div className="space-y-2">
                <Label htmlFor="secret-env">Environment</Label>
                <Select value={addEnv} onValueChange={setAddEnv}>
                  <SelectTrigger id="secret-env">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENVIRONMENTS.map((env) => (
                      <SelectItem key={env} value={env}>{env}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="secret-key">Key</Label>
                <Input
                  id="secret-key"
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                  placeholder="DATABASE_URL"
                  className="font-mono"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="secret-value">Value</Label>
                <textarea
                  id="secret-value"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 font-mono"
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  placeholder="postgres://..."
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCloseAdd}>Cancel</Button>
              <Button type="submit" disabled={addMutation.isPending}>
                {addMutation.isPending ? 'Adding...' : 'Add Secret'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Update Secret dialog */}
      <Dialog open={updateSecret !== null} onOpenChange={(v) => { if (!v) { setUpdateSecret(null); setUpdateValue(''); setUpdateError('') } }}>
        <DialogContent>
          <form onSubmit={handleSubmitUpdate}>
            <DialogHeader>
              <DialogTitle>Update Secret</DialogTitle>
              <DialogDescription>
                Set a new value for{' '}
                <code className="font-mono text-sm">{updateSecret?.key}</code>.
                A new version will be created.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              {updateError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{updateError}</div>
              )}
              <div className="space-y-2">
                <Label htmlFor="update-value">New Value</Label>
                <textarea
                  id="update-value"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 font-mono"
                  value={updateValue}
                  onChange={(e) => setUpdateValue(e.target.value)}
                  placeholder="New secret value"
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setUpdateSecret(null); setUpdateValue(''); setUpdateError('') }}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Updating...' : 'Update Secret'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reveal value modal */}
      <Dialog open={revealModalSecret !== null} onOpenChange={(v) => { if (!v) setRevealModalSecret(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Secret Value</DialogTitle>
            <DialogDescription>
              This is a one-time reveal. Copy the value now — it will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
              <code className="flex-1 text-sm font-mono break-all">
                {revealModalSecret?.value}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => revealModalSecret && copyToClipboard(revealModalSecret.value)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealModalSecret(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Secret</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this secret? All versions will be removed and this
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

function SettingsPage() {
  const { teamId } = Route.useParams()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Manage integrations and credentials for your team.</p>
      </div>

      <Tabs defaultValue="github">
        <TabsList>
          <TabsTrigger value="github">
            <GitBranch className="mr-2 h-4 w-4" />
            GitHub
          </TabsTrigger>
          <TabsTrigger value="registries">
            <Container className="mr-2 h-4 w-4" />
            Registries
          </TabsTrigger>
          <TabsTrigger value="secrets">
            <KeyRound className="mr-2 h-4 w-4" />
            Secrets
          </TabsTrigger>
        </TabsList>

        <TabsContent value="github" className="mt-6">
          <GitHubTab teamId={teamId} />
        </TabsContent>

        <TabsContent value="registries" className="mt-6">
          <RegistriesTab teamId={teamId} />
        </TabsContent>

        <TabsContent value="secrets" className="mt-6">
          <SecretsTab teamId={teamId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
