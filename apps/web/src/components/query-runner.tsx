import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Save, Clock, BookMarked, AlertTriangle, Loader2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { QueryResult, QueryHistoryEntry, SavedQuery } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface QueryRunnerProps {
  databaseId: string
  projectId: string
}

type SidePane = 'history' | 'saved'

export function QueryRunner({ databaseId, projectId }: QueryRunnerProps) {
  const queryClient = useQueryClient()
  const [sql, setSql] = useState('SELECT 1;')
  const [writeMode, setWriteMode] = useState(false)
  const [sidePane, setSidePane] = useState<SidePane>('history')
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [statusError, setStatusError] = useState<string>('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const runMutation = useMutation({
    mutationFn: () =>
      api.post<QueryResult>(`/databases/${databaseId}/query`, {
        sql,
        write_mode: writeMode,
      }),
    onSuccess: (res) => {
      setResult(res)
      setStatusError(res.success ? '' : (res.error || 'Query failed'))
      queryClient.invalidateQueries({ queryKey: ['db-tooling', databaseId, 'history'] })
    },
    onError: (err) => {
      setResult(null)
      setStatusError(err instanceof ApiError ? err.message : 'Request failed')
    },
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post<SavedQuery>(`/projects/${projectId}/saved-queries`, {
        name: saveName,
        query_text: sql,
      }),
    onSuccess: () => {
      setSaveOpen(false)
      setSaveName('')
      queryClient.invalidateQueries({ queryKey: ['db-tooling', projectId, 'saved'] })
    },
    onError: (err) => {
      setStatusError(err instanceof ApiError ? err.message : 'Save failed')
    },
  })

  const historyQ = useQuery({
    queryKey: ['db-tooling', databaseId, 'history'],
    queryFn: () => api.get<QueryHistoryEntry[]>(`/databases/${databaseId}/query-history?limit=50`),
  })

  const savedQ = useQuery({
    queryKey: ['db-tooling', projectId, 'saved'],
    queryFn: () => api.get<SavedQuery[]>(`/projects/${projectId}/saved-queries`),
  })

  const runQuery = useCallback(() => {
    if (!sql.trim() || runMutation.isPending) return
    runMutation.mutate()
  }, [sql, runMutation])

  // Ctrl/Cmd+Enter to run.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (document.activeElement === textareaRef.current) {
          e.preventDefault()
          runQuery()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runQuery])

  const toggleWriteMode = () => {
    if (writeMode) {
      setWriteMode(false)
      return
    }
    if (confirm('Enable write mode? Reads run as app_user. DDL is always blocked.')) {
      setWriteMode(true)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={runQuery} disabled={runMutation.isPending || !sql.trim()} size="sm">
            {runMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Run
            <span className="ml-2 text-[10px] opacity-70">Ctrl+Enter</span>
          </Button>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
            <input
              type="checkbox"
              checked={writeMode}
              onChange={toggleWriteMode}
              className="h-4 w-4"
            />
            <span>Write mode</span>
            {writeMode && (
              <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700">
                ON
              </span>
            )}
          </label>
          <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)} disabled={!sql.trim()}>
            <Save className="mr-2 h-4 w-4" /> Save query
          </Button>
        </div>

        <textarea
          ref={textareaRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={10}
          spellCheck={false}
          className="w-full rounded-md border bg-background p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="SELECT * FROM ..."
        />

        {/* Status */}
        <div className="min-h-[20px] text-sm">
          {statusError && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-600">
              {statusError}
            </div>
          )}
          {!statusError && result?.success && (
            <div className="text-muted-foreground">
              {(result.rows?.length ?? 0) > 0
                ? `${result.rows!.length} row${result.rows!.length === 1 ? '' : 's'} in ${result.execution_time_ms}ms`
                : (result.affected_rows ?? 0) > 0
                  ? `${result.affected_rows} affected row${result.affected_rows === 1 ? '' : 's'} in ${result.execution_time_ms}ms`
                  : `OK in ${result.execution_time_ms}ms`}
            </div>
          )}
          {result?.truncated && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Result truncated at 1000 rows. Use a more specific query to see more.</span>
            </div>
          )}
        </div>

        {/* Result grid */}
        {result?.success && result.columns && result.columns.length > 0 && (
          <div className="overflow-auto rounded-md border" style={{ maxHeight: 480 }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-muted/50">
                <tr>
                  {result.columns.map((col) => (
                    <th key={col.name} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                      {col.name}
                      {col.type_name && (
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">{col.type_name}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(result.rows ?? []).map((r, i) => (
                  <tr key={i} className="border-t">
                    {r.values.map((v, j) => (
                      <td key={j} className="px-3 py-1.5 font-mono text-xs">
                        {r.nulls?.[j] ? (
                          <span className="italic text-muted-foreground">NULL</span>
                        ) : (
                          <span className="break-all">{v}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Raw text (mongo/redis output via the query runner if ever used here) */}
        {result?.success && result.raw_text && (!result.columns || result.columns.length === 0) && (
          <pre className="max-h-[480px] overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
            {result.raw_text}
          </pre>
        )}
      </div>

      {/* Right side panel */}
      <div className="space-y-2">
        <div className="flex gap-1 rounded-md bg-muted p-1 text-xs">
          <button
            type="button"
            onClick={() => setSidePane('history')}
            className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 ${
              sidePane === 'history' ? 'bg-background shadow' : 'text-muted-foreground'
            }`}
          >
            <Clock className="h-3 w-3" /> History
          </button>
          <button
            type="button"
            onClick={() => setSidePane('saved')}
            className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 ${
              sidePane === 'saved' ? 'bg-background shadow' : 'text-muted-foreground'
            }`}
          >
            <BookMarked className="h-3 w-3" /> Saved
          </button>
        </div>

        <div className="max-h-[600px] space-y-1 overflow-auto rounded-md border p-1">
          {sidePane === 'history' && (
            <>
              {historyQ.isLoading && (
                <div className="p-3 text-center text-xs text-muted-foreground">Loading…</div>
              )}
              {!historyQ.isLoading && (historyQ.data?.length ?? 0) === 0 && (
                <div className="p-3 text-center text-xs text-muted-foreground">No history yet.</div>
              )}
              {(historyQ.data ?? []).map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setSql(h.query_text)}
                  className="block w-full rounded p-2 text-left hover:bg-muted"
                >
                  <div className="line-clamp-2 font-mono text-[11px] break-all">{h.query_text}</div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>
                      {h.execution_time_ms != null ? `${h.execution_time_ms}ms` : '—'}
                      {h.row_count != null ? ` · ${h.row_count} rows` : ''}
                      {h.write_mode ? ' · write' : ''}
                    </span>
                    {h.error && <span className="text-red-500">err</span>}
                  </div>
                </button>
              ))}
            </>
          )}

          {sidePane === 'saved' && (
            <>
              {savedQ.isLoading && (
                <div className="p-3 text-center text-xs text-muted-foreground">Loading…</div>
              )}
              {!savedQ.isLoading && (savedQ.data?.length ?? 0) === 0 && (
                <div className="p-3 text-center text-xs text-muted-foreground">No saved queries.</div>
              )}
              {(savedQ.data ?? []).map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setSql(q.query_text)}
                  className="block w-full rounded p-2 text-left hover:bg-muted"
                >
                  <div className="font-medium text-xs">{q.name}</div>
                  <div className="line-clamp-1 font-mono text-[10px] text-muted-foreground break-all">
                    {q.query_text}
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {saveOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setSaveOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-background p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-base font-semibold">Save query</h3>
            <Label className="text-xs">Name</Label>
            <Input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. Active users last 24h"
              className="mt-1"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setSaveOpen(false)}>Cancel</Button>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={!saveName.trim() || saveMutation.isPending}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
