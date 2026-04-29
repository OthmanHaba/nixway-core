import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Download, Trash2, Plus, Clock, AlertTriangle } from 'lucide-react'

export interface DatabaseBackup {
  id: string
  database_id: string
  type: string
  status: string
  size_bytes: number | null
  storage_type: string
  storage_path: string | null
  backup_tool: string
  triggered_by: { Bytes?: string; Valid: boolean } | null
  started_at: string
  completed_at: string | null
  error: string | null
}

interface RestoreResultPayload {
  database: { id: string; name: string }
  restart_required: boolean
  note?: string
}

interface DatabaseBackupsProps {
  databaseId: string
  projectId: string
  templateSlug: string
  databaseName: string
  backupSchedule: string | null
  retentionDays: number | null
}

function formatBytes(n: number | null) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function statusBadge(status: string) {
  const variants: Record<
    string,
    { variant: 'default' | 'secondary' | 'destructive'; className?: string }
  > = {
    completed: { variant: 'default', className: 'bg-green-500 hover:bg-green-500' },
    running: { variant: 'default', className: 'bg-blue-500 hover:bg-blue-500' },
    failed: { variant: 'destructive' },
  }
  const cfg = variants[status] ?? { variant: 'secondary' as const }
  return (
    <Badge variant={cfg.variant} className={cfg.className}>
      {status}
    </Badge>
  )
}

export function DatabaseBackups({
  databaseId,
  projectId,
  databaseName,
  backupSchedule,
  retentionDays,
}: DatabaseBackupsProps) {
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [restoreFor, setRestoreFor] = useState<DatabaseBackup | null>(null)
  const [restoreMode, setRestoreMode] = useState<'in_place' | 'new'>('in_place')
  const [restoreNewName, setRestoreNewName] = useState('')
  const [restoreNote, setRestoreNote] = useState<string | null>(null)

  const backupsKey = ['databases', databaseId, 'backups']

  const { data: backups = [], isLoading } = useQuery({
    queryKey: backupsKey,
    queryFn: () =>
      api.get<DatabaseBackup[]>(
        `/projects/${projectId}/databases/${databaseId}/backups`,
      ),
    refetchInterval: 5000,
  })

  const create = useMutation({
    mutationFn: () =>
      api.post<DatabaseBackup>(
        `/projects/${projectId}/databases/${databaseId}/backups`,
        {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupsKey })
      setError('')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to create backup'),
  })

  const remove = useMutation({
    mutationFn: (backupID: string) =>
      api.delete(
        `/projects/${projectId}/databases/${databaseId}/backups/${backupID}`,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupsKey }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to delete backup'),
  })

  const restore = useMutation({
    mutationFn: (vars: { backupID: string; target: 'in_place' | 'new'; newName: string }) =>
      api.post<RestoreResultPayload>(
        `/projects/${projectId}/databases/${databaseId}/restore`,
        {
          backup_id: vars.backupID,
          target: vars.target,
          new_name: vars.newName || undefined,
        },
      ),
    onSuccess: (res) => {
      setRestoreFor(null)
      setRestoreNewName('')
      if (res.restart_required) {
        setRestoreNote(
          res.note ??
            'Restore placed but the container must be restarted for it to take effect.',
        )
      } else {
        setRestoreNote(`Restored into "${res.database.name}".`)
      }
      queryClient.invalidateQueries({ queryKey: ['databases', databaseId] })
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'databases'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to restore'),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Backups</h3>
          <p className="text-xs text-muted-foreground">
            {backupSchedule
              ? `Scheduled: ${backupSchedule} · Retention: ${retentionDays ?? 7} days`
              : `No schedule configured · Retention: ${retentionDays ?? 7} days`}
          </p>
        </div>
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Back up now
        </Button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {restoreNote && (
        <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-3 text-sm text-blue-700">
          {restoreNote}
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-6"
            onClick={() => setRestoreNote(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : backups.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Clock className="mx-auto mb-2 h-6 w-6" />
          No backups yet for <span className="font-mono">{databaseName}</span>.
          {backupSchedule
            ? ' Scheduled backups will appear here once they run.'
            : ' Click "Back up now" to create one.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Tool</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Error</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">
                    {new Date(b.started_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{statusBadge(b.status)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{b.type}</td>
                  <td className="px-3 py-2 font-mono text-xs">{b.backup_tool}</td>
                  <td className="px-3 py-2 text-xs">{formatBytes(b.size_bytes)}</td>
                  <td className="max-w-[18rem] truncate px-3 py-2 text-xs text-muted-foreground">
                    {b.error ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {b.status === 'completed' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRestoreFor(b)
                            setRestoreMode('in_place')
                            setRestoreNewName('')
                          }}
                        >
                          <Download className="mr-1 h-3.5 w-3.5" /> Restore
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm('Delete this backup? The file will be removed from storage.')) {
                            remove.mutate(b.id)
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!restoreFor} onOpenChange={(v) => { if (!v) setRestoreFor(null) }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Restore from backup
            </DialogTitle>
            <DialogDescription>
              {restoreFor &&
                `Restore the backup taken ${new Date(restoreFor.started_at).toLocaleString()} (${formatBytes(restoreFor.size_bytes)}, ${restoreFor.backup_tool}).`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Target</Label>
              <div className="space-y-1 text-sm">
                <label className="flex items-start gap-2 rounded-md border p-2 hover:bg-muted/50">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={restoreMode === 'in_place'}
                    onChange={() => setRestoreMode('in_place')}
                  />
                  <div>
                    <p className="font-medium">In place</p>
                    <p className="text-xs text-muted-foreground">
                      Overwrite the existing database <code className="font-mono">{databaseName}</code>.
                      Existing data will be replaced.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-2 rounded-md border p-2 hover:bg-muted/50">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={restoreMode === 'new'}
                    onChange={() => setRestoreMode('new')}
                  />
                  <div>
                    <p className="font-medium">New database</p>
                    <p className="text-xs text-muted-foreground">
                      Provision a fresh database with the same template/version, then restore into it.
                    </p>
                  </div>
                </label>
              </div>
            </div>
            {restoreMode === 'new' && (
              <div className="space-y-1">
                <Label htmlFor="new-name">New database name (optional)</Label>
                <Input
                  id="new-name"
                  value={restoreNewName}
                  onChange={(e) => setRestoreNewName(e.target.value)}
                  placeholder="auto-generated if blank"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (restoreFor) {
                  restore.mutate({
                    backupID: restoreFor.id,
                    target: restoreMode,
                    newName: restoreNewName,
                  })
                }
              }}
              disabled={restore.isPending}
            >
              {restore.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
