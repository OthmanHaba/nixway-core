import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { Database, ServiceTemplateDetail } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Play, Square, Trash2, Database as DatabaseIcon, Link2, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { TableBrowser } from '@/components/table-browser'
import { QueryRunner } from '@/components/query-runner'
import { RedisInspector } from '@/components/redis-inspector'
import { MongoBrowser } from '@/components/mongo-browser'
import { DatabaseLinks } from '@/components/database-links'
import { DatabaseBackups } from '@/components/database-backups'

interface RotationRecord {
  id: string
  database_id: string
  rotated_by: string
  status: string
  linked_apps_restarted: number
  error: string | null
  created_at: string
  completed_at: string | null
}

export const Route = createFileRoute('/_app/databases_/$teamId/detail/$databaseId')({
  component: DatabaseDetailPage,
})

type TabKey = 'overview' | 'tables' | 'query' | 'redis' | 'mongo' | 'links' | 'backups'

function statusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive'; className?: string }> = {
    running: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    provisioning: { variant: 'default', className: 'bg-blue-500 hover:bg-blue-500' },
    stopped: { variant: 'secondary' },
    error: { variant: 'destructive' },
  }
  const cfg = map[status] ?? { variant: 'secondary' as const }
  return <Badge variant={cfg.variant} className={cfg.className}>{status}</Badge>
}

function DatabaseDetailPage() {
  const { teamId, databaseId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [tab, setTab] = useState<TabKey>('overview')

  // Fetch the database via the team-scoped direct endpoint so deep-links
  // (refresh, paste URL) work without a ?project= query param. The
  // project-scoped tabs below derive projectId from the row itself.
  const { data: db, isLoading } = useQuery({
    queryKey: ['databases', databaseId],
    queryFn: () => api.get<Database>(`/databases/${databaseId}`),
    refetchInterval: 10_000,
  })
  const projectId = db?.project_id ?? ''

  const { data: tmpl } = useQuery({
    queryKey: ['templates', db?.template_slug],
    queryFn: () => api.get<ServiceTemplateDetail>(`/templates/${db?.template_slug}`),
    enabled: !!db?.template_slug,
  })

  const stop = useMutation({
    mutationFn: () => api.post<Database>(`/projects/${projectId}/databases/${databaseId}/stop`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['databases', databaseId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to stop'),
  })
  const start = useMutation({
    mutationFn: () => api.post<Database>(`/projects/${projectId}/databases/${databaseId}/start`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['databases', databaseId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to start'),
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/databases/${databaseId}`),
    onSuccess: () => navigate({ to: '/databases/$teamId/$projectId', params: { teamId, projectId } }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to delete'),
  })

  // Rotate app-user credentials.
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null)
  const rotate = useMutation({
    mutationFn: () =>
      api.post<{ new_password: string; rotation_id: string }>(
        `/projects/${projectId}/databases/${databaseId}/rotate`,
        {},
      ),
    onSuccess: (res) => {
      setRevealedPassword(res.new_password)
      queryClient.invalidateQueries({ queryKey: ['rotations', databaseId] })
      queryClient.invalidateQueries({ queryKey: ['databases', databaseId] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to rotate'),
  })

  const { data: rotations } = useQuery({
    queryKey: ['rotations', databaseId],
    queryFn: () =>
      api.get<RotationRecord[]>(`/projects/${projectId}/databases/${databaseId}/rotations`),
    enabled: !!projectId,
  })

  // Rebind a volume from another database in the same project to THIS DB.
  const [rebindOpen, setRebindOpen] = useState(false)
  const [rebindWarning, setRebindWarning] = useState('')
  const { data: siblingDBs } = useQuery({
    queryKey: ['databases', 'project', projectId],
    queryFn: () => api.get<Database[]>(`/projects/${projectId}/databases`),
    enabled: !!projectId && rebindOpen,
  })
  const rebind = useMutation({
    mutationFn: (oldID: string) =>
      api.post<{ warning: string }>(
        `/projects/${projectId}/databases/${databaseId}/rebind-volume`,
        { old_database_id: oldID },
      ),
    onSuccess: (res) => {
      setRebindWarning(res.warning ?? '')
      setRebindOpen(false)
      queryClient.invalidateQueries({ queryKey: ['databases', databaseId] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to rebind volume'),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }
  if (!db) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Database not found</div>
  }

  // Build a masked connection-string preview from the template's format string.
  const maskedConn = (() => {
    if (!tmpl?.conn_string_fmt) return ''
    return tmpl.conn_string_fmt
      .replace('{user}', 'app_user')
      .replace('{password}', '••••••••')
      .replace('{root_password}', '••••••••')
      .replace('{host}', db.dns_record ?? db.container_name)
      .replace('{port}', String(db.port))
      .replace('{dbname}', db.name)
  })()

  const isSQL = db.template_slug === 'postgresql' || db.template_slug === 'postgres' ||
    db.template_slug === 'mysql' || db.template_slug === 'mariadb'
  const isRedis = db.template_slug === 'redis'
  const isMongo = db.template_slug === 'mongodb' || db.template_slug === 'mongo'

  const tabs: { key: TabKey; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'tables', label: 'Tables', show: isSQL },
    { key: 'query', label: 'Query', show: isSQL },
    { key: 'redis', label: 'Redis', show: isRedis },
    { key: 'mongo', label: 'Mongo', show: isMongo },
    { key: 'links', label: 'Linked Apps', show: true },
    { key: 'backups', label: 'Backups', show: true },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DatabaseIcon className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-bold">{db.name}</h1>
            <p className="text-sm text-muted-foreground">{db.template_slug}:{db.version}</p>
          </div>
          {statusBadge(db.status)}
        </div>
        <div className="flex gap-2">
          {db.status === 'running' ? (
            <Button variant="outline" onClick={() => stop.mutate()} disabled={stop.isPending}>
              <Square className="mr-2 h-4 w-4" /> Stop
            </Button>
          ) : (
            <Button variant="outline" onClick={() => start.mutate()} disabled={start.isPending}>
              <Play className="mr-2 h-4 w-4" /> Start
            </Button>
          )}
          <Button variant="outline" onClick={() => setRebindOpen(true)}>
            <Link2 className="mr-2 h-4 w-4" /> Rebind volume
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (confirm('Rotate the app-user password? Linked apps will be redeployed automatically.')) {
                rotate.mutate()
              }
            }}
            disabled={rotate.isPending}
          >
            <KeyRound className="mr-2 h-4 w-4" /> Rotate credentials
          </Button>
          <Button
            variant="destructive"
            onClick={() => { if (confirm('Delete this database? Volume and secrets will be retained.')) remove.mutate() }}
            disabled={remove.isPending}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {rebindWarning && (
        <p className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-sm text-yellow-700">
          {rebindWarning}
        </p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b">
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {rebindOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRebindOpen(false)}>
              <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
                <h2 className="mb-2 text-lg font-semibold">Rebind volume from another database</h2>
                <p className="mb-4 text-xs text-muted-foreground">
                  Detaches the source DB&rsquo;s volume and attaches it to <code className="font-mono">{db.name}</code>.
                  Both DBs must use the same template.
                </p>
                <div className="space-y-2 max-h-64 overflow-auto">
                  {(siblingDBs ?? [])
                    .filter((d) => d.id !== databaseId && d.template_slug === db.template_slug)
                    .map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => rebind.mutate(d.id)}
                        disabled={rebind.isPending}
                        className="flex w-full items-center justify-between rounded-md border p-2 text-left text-sm hover:bg-muted"
                      >
                        <span className="font-mono">{d.name}</span>
                        <span className="text-xs text-muted-foreground">{d.template_slug}:{d.version}</span>
                      </button>
                    ))}
                  {(siblingDBs ?? []).filter((d) => d.id !== databaseId && d.template_slug === db.template_slug).length === 0 && (
                    <p className="text-sm text-muted-foreground">No compatible source databases in this project.</p>
                  )}
                </div>
                <div className="mt-4 flex justify-end">
                  <Button variant="outline" onClick={() => setRebindOpen(false)}>Cancel</Button>
                </div>
              </div>
            </div>
          )}

          {revealedPassword && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              onClick={() => setRevealedPassword(null)}
            >
              <div
                className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="mb-2 text-lg font-semibold">New app-user password</h2>
                <p className="mb-4 text-xs text-muted-foreground">
                  Copy this password now. It will not be shown again. Linked apps are
                  being redeployed and will pick up the new credentials automatically.
                </p>
                <code className="block break-all rounded-md bg-muted p-2 font-mono text-xs">
                  {revealedPassword}
                </code>
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(revealedPassword)}
                  >
                    Copy
                  </Button>
                  <Button onClick={() => setRevealedPassword(null)}>Done</Button>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Container</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Container name" value={db.container_name} mono />
                <Row label="Port" value={String(db.port)} mono />
                <Row label="DNS record" value={db.dns_record ?? '(pending)'} mono />
                <Row label="CPU" value={`${db.resource_cpu_millicores} mcpu`} />
                <Row label="Memory" value={`${db.resource_memory_mb} MB`} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Connection</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  Password is masked. Reveal credentials from the secrets store.
                </p>
                <code className="block rounded-md bg-muted p-2 text-xs break-all">{maskedConn || '(no template)'}</code>
                <Row label="Superuser secret" value={db.superuser_secret_id?.slice(0, 8) ?? '—'} mono />
                <Row label="App-user secret" value={db.appuser_secret_id?.slice(0, 8) ?? '—'} mono />
              </CardContent>
            </Card>
          </div>

          {(rotations?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Rotation history</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">When</th>
                      <th className="py-1 pr-3">Status</th>
                      <th className="py-1 pr-3">Linked apps restarted</th>
                      <th className="py-1 pr-3">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rotations!.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="py-1 pr-3 font-mono text-xs">
                          {new Date(r.created_at).toLocaleString()}
                        </td>
                        <td className="py-1 pr-3">
                          <Badge
                            variant={
                              r.status === 'completed'
                                ? 'default'
                                : r.status === 'partial'
                                  ? 'secondary'
                                  : r.status === 'failed'
                                    ? 'destructive'
                                    : 'secondary'
                            }
                          >
                            {r.status}
                          </Badge>
                        </td>
                        <td className="py-1 pr-3">{r.linked_apps_restarted}</td>
                        <td className="py-1 pr-3 text-xs text-muted-foreground">
                          {r.error ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === 'tables' && isSQL && <TableBrowser databaseId={databaseId} />}
      {tab === 'query' && isSQL && <QueryRunner databaseId={databaseId} projectId={projectId} />}
      {tab === 'redis' && isRedis && <RedisInspector databaseId={databaseId} />}
      {tab === 'mongo' && isMongo && <MongoBrowser databaseId={databaseId} />}
      {tab === 'links' && (
        <DatabaseLinks databaseId={databaseId} projectId={projectId} />
      )}
      {tab === 'backups' && (
        <DatabaseBackups
          databaseId={databaseId}
          projectId={projectId}
          templateSlug={db.template_slug}
          databaseName={db.name}
          backupSchedule={db.backup_schedule ?? null}
          retentionDays={db.backup_retention_days ?? null}
        />
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value}</span>
    </div>
  )
}

