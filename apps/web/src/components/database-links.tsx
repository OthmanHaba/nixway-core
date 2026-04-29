import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { App, DatabaseLink } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface DatabaseLinksProps {
  databaseId: string
  projectId: string
}

export function DatabaseLinks({ databaseId, projectId }: DatabaseLinksProps) {
  const queryClient = useQueryClient()
  const [appId, setAppId] = useState('')
  const [envPrefix, setEnvPrefix] = useState('')
  const [linkError, setLinkError] = useState('')

  const linksQ = useQuery({
    queryKey: ['db-tooling', databaseId, 'links'],
    queryFn: () =>
      api.get<DatabaseLink[]>(`/projects/${projectId}/databases/${databaseId}/links`),
  })

  const appsQ = useQuery({
    queryKey: ['projects', projectId, 'apps'],
    queryFn: () => api.get<App[]>(`/projects/${projectId}/apps`),
  })

  const link = useMutation({
    mutationFn: () =>
      api.post<DatabaseLink>(`/projects/${projectId}/databases/${databaseId}/links`, {
        app_id: appId,
        env_prefix: envPrefix,
      }),
    onSuccess: () => {
      setAppId('')
      setEnvPrefix('')
      setLinkError('')
      queryClient.invalidateQueries({ queryKey: ['db-tooling', databaseId, 'links'] })
    },
    onError: (e) => setLinkError(e instanceof ApiError ? e.message : 'Failed to link'),
  })

  const unlink = useMutation({
    mutationFn: (linkId: string) =>
      api.delete(`/projects/${projectId}/databases/${databaseId}/links/${linkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-tooling', databaseId, 'links'] })
    },
    onError: (e) => setLinkError(e instanceof ApiError ? e.message : 'Failed to unlink'),
  })

  const linkedAppIds = new Set((linksQ.data ?? []).map((l) => l.app_id))
  const availableApps = (appsQ.data ?? []).filter((a) => !linkedAppIds.has(a.id))

  const appName = (id: string) => (appsQ.data ?? []).find((a) => a.id === id)?.name ?? id.slice(0, 8)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked apps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {linkError && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-600">
            {linkError}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!appId) {
              setLinkError('Pick an app first')
              return
            }
            link.mutate()
          }}
          className="grid gap-3 md:grid-cols-[1fr_180px_auto]"
        >
          <div className="space-y-1">
            <Label className="text-xs">App</Label>
            <select
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Select an app…</option>
              {availableApps.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Env prefix (optional)</Label>
            <Input
              value={envPrefix}
              onChange={(e) => setEnvPrefix(e.target.value)}
              placeholder="DATABASE"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={!appId || link.isPending} className="w-full md:w-auto">
              <Plus className="mr-2 h-4 w-4" /> Link
            </Button>
          </div>
        </form>

        {linksQ.isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}

        {!linksQ.isLoading && (linksQ.data?.length ?? 0) === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No apps linked yet. Linking injects connection vars into the app&rsquo;s environment.
          </div>
        )}

        {(linksQ.data?.length ?? 0) > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">App</th>
                <th className="py-1 pr-3">Env prefix</th>
                <th className="py-1 pr-3">Linked</th>
                <th className="py-1 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {(linksQ.data ?? []).map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="py-2 pr-3">{appName(l.app_id)}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{l.env_prefix || '—'}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {new Date(l.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Unlink ${appName(l.app_id)}? Connection vars will be removed on next deploy.`)) {
                          unlink.mutate(l.id)
                        }
                      }}
                      disabled={unlink.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
