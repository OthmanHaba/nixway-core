import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Search, RefreshCw } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { QueryResult } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface RedisInspectorProps {
  databaseId: string
}

type RightPane = 'viewer' | 'info' | 'config'

interface RedisKeyValue {
  type?: string
  ttl?: number
  value?: unknown
}

// Parse the agent's RedisListKeys raw_text. The agent sends a JSON object
// with `keys` and `next_cursor` per redis_inspector.go contract.
function parseKeysResult(res: QueryResult): { keys: string[]; cursor: string } {
  if (res.raw_text) {
    try {
      const parsed = JSON.parse(res.raw_text) as { keys?: string[]; cursor?: string; next_cursor?: string }
      return {
        keys: parsed.keys ?? [],
        cursor: parsed.cursor ?? parsed.next_cursor ?? '0',
      }
    } catch {
      // fallthrough
    }
  }
  // Fallback to row-based output (one key per row).
  const keys = (res.rows ?? []).map((r) => r.values?.[0]).filter((s): s is string => !!s)
  return { keys, cursor: '0' }
}

function parseKeyValue(res: QueryResult): RedisKeyValue {
  if (res.raw_text) {
    try {
      return JSON.parse(res.raw_text) as RedisKeyValue
    } catch {
      // not JSON — treat as plain string value
      return { type: 'string', value: res.raw_text }
    }
  }
  return {}
}

function parseConfigText(text: string): Array<[string, string]> {
  // CONFIG GET <pattern> returns alternating key/value lines or a JSON map.
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as Record<string, string>
    return Object.entries(parsed)
  } catch {
    // alternating lines
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    const out: Array<[string, string]> = []
    for (let i = 0; i + 1 < lines.length; i += 2) {
      out.push([lines[i], lines[i + 1]])
    }
    return out
  }
}

export function RedisInspector({ databaseId }: RedisInspectorProps) {
  const [pattern, setPattern] = useState('*')
  const [count, setCount] = useState(50)
  const [nextCursor, setNextCursor] = useState('0')
  const [accumulatedKeys, setAccumulatedKeys] = useState<string[]>([])
  const [selectedKey, setSelectedKey] = useState<string>('')
  const [rightPane, setRightPane] = useState<RightPane>('viewer')
  const [scanError, setScanError] = useState('')

  // Scan is event-driven (Scan / Load more buttons). Use a mutation so we can
  // accumulate results in onSuccess without an effect.
  const scanM = useMutation({
    mutationFn: ({ cursor, reset }: { cursor: string; reset: boolean }) =>
      api.get<QueryResult>(
        `/databases/${databaseId}/redis/keys?pattern=${encodeURIComponent(pattern)}&cursor=${encodeURIComponent(cursor)}&count=${count}`,
      ).then((r) => ({ result: r, reset })),
    onSuccess: ({ result, reset }) => {
      if (!result.success) {
        setScanError(result.error || 'Scan failed')
        if (reset) setAccumulatedKeys([])
        return
      }
      setScanError('')
      const parsed = parseKeysResult(result)
      setNextCursor(parsed.cursor || '0')
      setAccumulatedKeys((prev) => {
        if (reset) return parsed.keys
        const merged = new Set([...prev, ...parsed.keys])
        return Array.from(merged)
      })
    },
    onError: (err) => {
      setScanError(err instanceof ApiError ? err.message : 'Scan failed')
    },
  })

  const onScan = () => {
    setNextCursor('0')
    setAccumulatedKeys([])
    scanM.mutate({ cursor: '0', reset: true })
  }
  const onLoadMore = () => {
    scanM.mutate({ cursor: nextCursor, reset: false })
  }

  const keyQ = useQuery({
    queryKey: ['db-tooling', databaseId, 'redis', 'key', selectedKey],
    queryFn: () => api.get<QueryResult>(`/databases/${databaseId}/redis/key?key=${encodeURIComponent(selectedKey)}`),
    enabled: !!selectedKey && rightPane === 'viewer',
  })

  const infoQ = useQuery({
    queryKey: ['db-tooling', databaseId, 'redis', 'info'],
    queryFn: () => api.get<QueryResult>(`/databases/${databaseId}/redis/info`),
    enabled: rightPane === 'info',
    refetchInterval: rightPane === 'info' ? 5_000 : false,
  })

  const configQ = useQuery({
    queryKey: ['db-tooling', databaseId, 'redis', 'config'],
    queryFn: () => api.get<QueryResult>(`/databases/${databaseId}/redis/config?pattern=*`),
    enabled: rightPane === 'config',
    refetchInterval: rightPane === 'config' ? 5_000 : false,
  })

  const keyValue = keyQ.data ? parseKeyValue(keyQ.data) : null

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      {/* Left: scanner + key list */}
      <div className="space-y-3">
        <div className="space-y-2 rounded-md border p-3">
          <div className="space-y-1">
            <Label className="text-xs">Pattern</Label>
            <Input value={pattern} onChange={(e) => setPattern(e.target.value)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Count</Label>
            <Input
              type="number"
              min={1}
              max={1000}
              value={count}
              onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 50))}
              className="h-8"
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={onScan}
            disabled={scanM.isPending}
          >
            {scanM.isPending && accumulatedKeys.length === 0 ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Scan
          </Button>
        </div>

        {scanError && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-600">
            {scanError}
          </div>
        )}

        <div className="rounded-md border">
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            {accumulatedKeys.length} key{accumulatedKeys.length === 1 ? '' : 's'}
          </div>
          <div className="max-h-[400px] overflow-auto">
            {scanM.isPending && accumulatedKeys.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            {accumulatedKeys.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => { setSelectedKey(k); setRightPane('viewer') }}
                className={`block w-full px-3 py-1.5 text-left font-mono text-xs hover:bg-muted ${
                  selectedKey === k ? 'bg-muted' : ''
                }`}
              >
                <span className="break-all">{k}</span>
              </button>
            ))}
            {!scanM.isPending && accumulatedKeys.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">No keys</div>
            )}
          </div>
          {nextCursor !== '0' && (
            <div className="border-t p-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onLoadMore}
                disabled={scanM.isPending}
              >
                {scanM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Right: key viewer / info / config */}
      <div className="space-y-3">
        <div className="flex gap-1 rounded-md bg-muted p-1 text-xs">
          {(['viewer', 'info', 'config'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setRightPane(p)}
              className={`flex-1 rounded px-3 py-1.5 capitalize ${
                rightPane === p ? 'bg-background shadow' : 'text-muted-foreground'
              }`}
            >
              {p === 'viewer' ? 'Key Viewer' : p.toUpperCase()}
            </button>
          ))}
        </div>

        {rightPane === 'viewer' && (
          <div className="rounded-md border p-3">
            {!selectedKey ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Select a key from the list to view its value.
              </div>
            ) : keyQ.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : keyQ.error ? (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-600">
                {keyQ.error instanceof ApiError ? keyQ.error.message : 'Failed to load key'}
              </div>
            ) : keyQ.data && !keyQ.data.success ? (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-600">
                {keyQ.data.error || 'Failed to load key'}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 border-b pb-2">
                  <code className="break-all font-mono text-sm font-semibold">{selectedKey}</code>
                  <div className="flex shrink-0 items-center gap-2">
                    {keyValue?.type && (
                      <span className="rounded bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium uppercase text-blue-600">
                        {keyValue.type}
                      </span>
                    )}
                    {typeof keyValue?.ttl === 'number' && (
                      <span className="text-[10px] text-muted-foreground">
                        TTL: {keyValue.ttl < 0 ? '∞' : `${keyValue.ttl}s`}
                      </span>
                    )}
                  </div>
                </div>
                <RedisValueView type={keyValue?.type} value={keyValue?.value} />
              </div>
            )}
          </div>
        )}

        {rightPane === 'info' && (
          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
              <span>INFO · auto-refresh 5s</span>
              <Button size="sm" variant="ghost" onClick={() => infoQ.refetch()}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
            {infoQ.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : infoQ.data && !infoQ.data.success ? (
              <div className="m-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-600">
                {infoQ.data.error || 'Failed to load INFO'}
              </div>
            ) : (
              <pre className="max-h-[500px] overflow-auto p-3 font-mono text-xs">
                {infoQ.data?.raw_text ?? ''}
              </pre>
            )}
          </div>
        )}

        {rightPane === 'config' && (
          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
              <span>CONFIG · auto-refresh 5s</span>
              <Button size="sm" variant="ghost" onClick={() => configQ.refetch()}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
            {configQ.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : configQ.data && !configQ.data.success ? (
              <div className="m-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-600">
                {configQ.data.error || 'Failed to load CONFIG'}
              </div>
            ) : (
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {parseConfigText(configQ.data?.raw_text ?? '').map(([k, v]) => (
                      <tr key={k} className="border-b">
                        <td className="px-3 py-1 font-mono font-medium">{k}</td>
                        <td className="px-3 py-1 font-mono break-all text-muted-foreground">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function RedisValueView({ type, value }: { type?: string; value: unknown }) {
  if (value == null) {
    return <div className="text-sm text-muted-foreground">No value</div>
  }
  switch (type) {
    case 'string':
      return (
        <pre className="max-h-[400px] overflow-auto rounded bg-muted/30 p-2 font-mono text-xs whitespace-pre-wrap break-all">
          {String(value)}
        </pre>
      )
    case 'hash':
      if (typeof value !== 'object') break
      return (
        <table className="w-full text-xs">
          <tbody>
            {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
              <tr key={k} className="border-b">
                <td className="px-2 py-1 font-mono font-medium">{k}</td>
                <td className="px-2 py-1 font-mono break-all text-muted-foreground">{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'list':
      if (!Array.isArray(value)) break
      return (
        <ol className="list-decimal space-y-1 pl-6 font-mono text-xs">
          {value.map((v, i) => <li key={i} className="break-all">{String(v)}</li>)}
        </ol>
      )
    case 'set':
      if (!Array.isArray(value)) break
      return (
        <ul className="list-disc space-y-1 pl-6 font-mono text-xs">
          {value.map((v, i) => <li key={i} className="break-all">{String(v)}</li>)}
        </ul>
      )
    case 'zset':
      if (!Array.isArray(value)) break
      return (
        <ol className="list-decimal space-y-1 pl-6 font-mono text-xs">
          {(value as Array<{ member?: unknown; score?: unknown } | unknown>).map((entry, i) => {
            if (entry && typeof entry === 'object' && 'member' in entry) {
              const e = entry as { member: unknown; score: unknown }
              return (
                <li key={i} className="break-all">
                  {String(e.member)} <span className="text-muted-foreground">({String(e.score)})</span>
                </li>
              )
            }
            return <li key={i} className="break-all">{String(entry)}</li>
          })}
        </ol>
      )
    case 'stream':
      if (!Array.isArray(value)) break
      return (
        <ol className="space-y-1 pl-2 font-mono text-xs">
          {value.map((entry, i) => (
            <li key={i} className="break-all rounded border-l-2 border-blue-500 bg-muted/30 px-2 py-1">
              {typeof entry === 'object' ? JSON.stringify(entry) : String(entry)}
            </li>
          ))}
        </ol>
      )
  }
  return (
    <pre className="max-h-[400px] overflow-auto rounded bg-muted/30 p-2 font-mono text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
