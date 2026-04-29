import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type {
  Cluster,
  Server,
  Database,
  DatabaseProvisionResult,
  ServiceTemplateSummary,
  ServiceTemplateDetail,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Loader2, Plus, Database as DatabaseIcon, Copy, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

interface ProvisionEvent {
  step: string
  level: 'info' | 'warn' | 'error' | string
  message: string
  terminal?: boolean
  success?: boolean
}

interface ProvisionRun {
  databaseId: string
  result: DatabaseProvisionResult
  events: ProvisionEvent[]
  status: 'streaming' | 'success' | 'failed'
}

export const Route = createFileRoute('/_app/databases/$teamId/$projectId')({
  component: DatabasesPage,
})

function statusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
    running: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    provisioning: { variant: 'default', className: 'bg-blue-500 hover:bg-blue-500' },
    stopped: { variant: 'secondary' },
    error: { variant: 'destructive' },
    deleted: { variant: 'secondary' },
  }
  const cfg = map[status] ?? { variant: 'secondary' as const }
  return <Badge variant={cfg.variant} className={cfg.className}>{status}</Badge>
}

function DatabasesPage() {
  const { teamId, projectId } = Route.useParams()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [run, setRun] = useState<ProvisionRun | null>(null)
  const [revealResult, setRevealResult] = useState<DatabaseProvisionResult | null>(null)
  const [error, setError] = useState('')

  const [templateSlug, setTemplateSlug] = useState('')
  const [version, setVersion] = useState('')
  const [name, setName] = useState('')
  const [clusterId, setClusterId] = useState('')
  const [serverId, setServerId] = useState('')
  const [sizeGB, setSizeGB] = useState('10')
  const [cpuMc, setCpuMc] = useState('500')
  const [memMb, setMemMb] = useState('512')
  const [backupSchedule, setBackupSchedule] = useState('')
  const [retentionDays, setRetentionDays] = useState('7')

  const { data: dbs = [], isLoading } = useQuery({
    queryKey: ['projects', projectId, 'databases'],
    queryFn: () => api.get<Database[]>(`/projects/${projectId}/databases`),
    refetchInterval: 15_000,
  })

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<ServiceTemplateSummary[]>(`/templates`),
  })

  const { data: templateDetail } = useQuery({
    queryKey: ['templates', templateSlug],
    queryFn: () => api.get<ServiceTemplateDetail>(`/templates/${templateSlug}`),
    enabled: !!templateSlug,
  })

  const { data: clusters = [] } = useQuery({
    queryKey: ['teams', teamId, 'clusters'],
    queryFn: () => api.get<Cluster[]>(`/teams/${teamId}/clusters`),
  })

  const { data: servers = [] } = useQuery({
    queryKey: ['teams', teamId, 'servers'],
    queryFn: () => api.get<Server[]>(`/teams/${teamId}/servers`),
  })

  const provision = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<DatabaseProvisionResult>(`/projects/${projectId}/databases`, body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'databases'] })
      setRun({
        databaseId: data.database.id,
        result: data,
        events: [],
        status: 'streaming',
      })
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to provision database')
    },
  })

  const resetForm = () => {
    setTemplateSlug('')
    setVersion('')
    setName('')
    setSizeGB('10')
    setCpuMc('500')
    setMemMb('512')
    setBackupSchedule('')
    setRetentionDays('7')
    setError('')
  }

  const handleClose = () => {
    if (run && run.status === 'streaming') {
      // Don't allow closing the dialog while provisioning is in flight; the
      // user would lose the credentials reveal-once view.
      return
    }
    setOpen(false)
    if (run) {
      // Hand off to the credentials reveal-once dialog before clearing.
      setRevealResult(run.result)
      setRun(null)
    }
    resetForm()
  }

  const handleSubmit = () => {
    if (!templateSlug || !version) {
      setError('Template and version are required')
      return
    }
    if (!clusterId) {
      setError('Cluster is required')
      return
    }
    provision.mutate({
      cluster_id: clusterId,
      server_id: serverId || undefined,
      template_slug: templateSlug,
      version,
      name: name.trim() || undefined,
      size_gb: parseInt(sizeGB, 10) || 10,
      cpu_millicores: parseInt(cpuMc, 10) || 500,
      memory_mb: parseInt(memMb, 10) || 512,
      backup_schedule: backupSchedule.trim() || undefined,
      retention_days: parseInt(retentionDays, 10) || 7,
    })
  }

  const versions = useMemo(() => templateDetail?.versions ?? [], [templateDetail])
  const clusterServers = useMemo(() => servers, [servers])

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
          <h1 className="text-2xl font-bold">Databases</h1>
          <p className="text-muted-foreground">Managed databases provisioned for this project</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true) }}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Provision Database</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[640px]">
            {run ? (
              <ProvisionConsole
                run={run}
                projectId={projectId}
                onEvent={(evt) => setRun((cur) => cur ? { ...cur, events: [...cur.events, evt] } : cur)}
                onTerminal={(success) => setRun((cur) => cur ? { ...cur, status: success ? 'success' : 'failed' } : cur)}
                onContinue={handleClose}
              />
            ) : (
            <>
            <DialogHeader>
              <DialogTitle>Provision Database</DialogTitle>
              <DialogDescription>
                Pick a template, version, placement, and resources. Credentials are generated for you.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {error && <p className="text-sm text-red-500">{error}</p>}

              <div>
                <Label htmlFor="template">Template</Label>
                <select
                  id="template"
                  value={templateSlug}
                  onChange={(e) => { setTemplateSlug(e.target.value); setVersion('') }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select a template</option>
                  {templates.map((t) => (
                    <option key={t.slug} value={t.slug}>{t.name} ({t.category})</option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="version">Version</Label>
                <select
                  id="version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  disabled={!templateSlug}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select a version</option>
                  {versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version}{v.default ? ' (default)' : ''} — {v.image}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                  <Label htmlFor="server">Server (optional)</Label>
                  <select
                    id="server"
                    value={serverId}
                    onChange={(e) => setServerId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Auto (lowest load)</option>
                    {clusterServers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label htmlFor="name">Name (optional)</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="auto-generated if blank"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="size">Size (GB)</Label>
                  <Input id="size" type="number" min="1" value={sizeGB} onChange={(e) => setSizeGB(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="cpu">CPU (m)</Label>
                  <Input id="cpu" type="number" min="100" value={cpuMc} onChange={(e) => setCpuMc(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="mem">Memory (MB)</Label>
                  <Input id="mem" type="number" min="64" value={memMb} onChange={(e) => setMemMb(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="backup-schedule">Backup schedule (cron, optional)</Label>
                  <Input
                    id="backup-schedule"
                    value={backupSchedule}
                    onChange={(e) => setBackupSchedule(e.target.value)}
                    placeholder="@daily or 0 3 * * *"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Leave blank for manual-only backups. Supports @hourly, @daily, @weekly,
                    @monthly, @every &lt;dur&gt;, or 5-field cron.
                  </p>
                </div>
                <div>
                  <Label htmlFor="retention-days">Retention (days)</Label>
                  <Input
                    id="retention-days"
                    type="number"
                    min="1"
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Older backups are deleted automatically.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose} disabled={provision.isPending}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={provision.isPending}>
                {provision.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Start Provisioning
              </Button>
            </DialogFooter>
            </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {dbs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <DatabaseIcon className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No databases yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Provision your first managed database to get started.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>DNS</TableHead>
              <TableHead>Container</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dbs.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">
                  <Link
                    to="/databases/$teamId/detail/$databaseId"
                    params={{ teamId, databaseId: d.id }}
                    className="text-primary hover:underline"
                  >
                    {d.name}
                  </Link>
                </TableCell>
                <TableCell>{d.template_slug}:{d.version}</TableCell>
                <TableCell>{statusBadge(d.status)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.dns_record ?? '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.container_name}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <RevealOnceDialog result={revealResult} onClose={() => setRevealResult(null)} />
    </div>
  )
}

function ProvisionConsole({
  run,
  projectId,
  onEvent,
  onTerminal,
  onContinue,
}: {
  run: ProvisionRun
  projectId: string
  onEvent: (evt: ProvisionEvent) => void
  onTerminal: (success: boolean) => void
  onContinue: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const dbId = run.databaseId

  useEffect(() => {
    const url = `/api/v1/projects/${projectId}/databases/${dbId}/provision-stream`
    const source = new EventSource(url, { withCredentials: true })
    source.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as ProvisionEvent
        onEvent(evt)
        if (evt.terminal) {
          onTerminal(!!evt.success)
          source.close()
        }
      } catch {
        // Ignore unparseable lines.
      }
    }
    source.onerror = () => {
      source.close()
    }
    return () => source.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbId, projectId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [run.events.length])

  const headerIcon =
    run.status === 'success' ? <CheckCircle2 className="h-5 w-5 text-green-500" /> :
    run.status === 'failed' ? <XCircle className="h-5 w-5 text-red-500" /> :
    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />

  const headerTitle =
    run.status === 'success' ? 'Database provisioned' :
    run.status === 'failed' ? 'Provisioning failed' :
    'Provisioning…'

  const continueLabel =
    run.status === 'success' ? 'Show credentials' :
    run.status === 'failed' ? 'Close' :
    'Provisioning…'

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {headerIcon} {headerTitle}
        </DialogTitle>
        <DialogDescription>
          {run.result.database.name} ({run.result.database.template_slug}:{run.result.database.version}) on container {run.result.database.container_name}
        </DialogDescription>
      </DialogHeader>
      <div
        ref={scrollRef}
        className="h-72 overflow-auto rounded-md border bg-zinc-950 p-3 font-mono text-xs text-zinc-100"
      >
        {run.events.length === 0 ? (
          <p className="text-zinc-500">Connecting to provisioning stream…</p>
        ) : (
          run.events.map((evt, i) => (
            <div key={i} className="flex gap-2 leading-5">
              <span className={
                evt.level === 'error' ? 'text-red-400' :
                evt.level === 'warn' ? 'text-yellow-400' :
                'text-emerald-400'
              }>
                [{evt.step}]
              </span>
              <span className="text-zinc-300 whitespace-pre-wrap break-words">{evt.message}</span>
            </div>
          ))
        )}
      </div>
      <DialogFooter>
        <Button onClick={onContinue} disabled={run.status === 'streaming'}>
          {run.status === 'streaming' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {continueLabel}
        </Button>
      </DialogFooter>
    </>
  )
}

function RevealOnceDialog({ result, onClose }: { result: DatabaseProvisionResult | null; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (label: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    })
  }
  if (!result) return null
  return (
    <Dialog open={!!result} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" /> Save these credentials now
          </DialogTitle>
          <DialogDescription>
            These passwords will <strong>not be shown again</strong>. Store them in your password manager
            or copy them into your app's secret store before closing this dialog.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <CredentialRow label="Database name" value={result.database.name} copied={copied} onCopy={copy} />
          <CredentialRow label="Container" value={result.database.container_name} copied={copied} onCopy={copy} />
          <CredentialRow label="DNS record" value={result.database.dns_record ?? '(pending)'} copied={copied} onCopy={copy} />
          <CredentialRow label="Superuser password" value={result.superuser_password} copied={copied} onCopy={copy} secret />
          <CredentialRow label="App user password" value={result.appuser_password} copied={copied} onCopy={copy} secret />
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I've saved them</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CredentialRow({
  label, value, copied, onCopy, secret,
}: {
  label: string; value: string; copied: string | null;
  onCopy: (label: string, value: string) => void; secret?: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-md border p-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`truncate font-mono text-sm ${secret ? 'tracking-wider' : ''}`}>{value}</p>
      </div>
      <Button size="sm" variant="ghost" onClick={() => onCopy(label, value)}>
        <Copy className="h-3.5 w-3.5 mr-1" />
        {copied === label ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}
