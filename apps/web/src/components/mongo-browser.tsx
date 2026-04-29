import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { QueryResult } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface MongoBrowserProps {
  databaseId: string
}

// Parse the agent's MongoListCollections raw_text. Expects a JSON array.
function parseCollections(res: QueryResult): string[] {
  if (res.raw_text) {
    try {
      const parsed = JSON.parse(res.raw_text) as string[] | { collections?: string[] }
      if (Array.isArray(parsed)) return parsed
      if (parsed && Array.isArray(parsed.collections)) return parsed.collections
    } catch {
      // fallthrough
    }
  }
  return (res.rows ?? []).map((r) => r.values?.[0]).filter((s): s is string => !!s)
}

function parseDocuments(res: QueryResult): unknown[] {
  if (res.raw_text) {
    try {
      const parsed = JSON.parse(res.raw_text) as unknown
      if (Array.isArray(parsed)) return parsed
      if (parsed && typeof parsed === 'object' && 'documents' in parsed) {
        const docs = (parsed as { documents?: unknown[] }).documents
        if (Array.isArray(docs)) return docs
      }
    } catch {
      // not JSON — return raw text as a single doc
      return [res.raw_text]
    }
  }
  return []
}

function getDocId(doc: unknown): string {
  if (doc && typeof doc === 'object' && '_id' in doc) {
    const id = (doc as { _id: unknown })._id
    if (typeof id === 'string') return id
    if (id && typeof id === 'object' && '$oid' in id) return String((id as { $oid: unknown }).$oid)
    return String(id)
  }
  return ''
}

export function MongoBrowser({ databaseId }: MongoBrowserProps) {
  const [collectionPick, setCollectionPick] = useState('')
  const [filter, setFilter] = useState('{}')
  const [limit, setLimit] = useState(50)
  const [skip, setSkip] = useState(0)
  const [executedFilter, setExecutedFilter] = useState('{}')
  const [executedLimit, setExecutedLimit] = useState(50)
  const [executedSkip, setExecutedSkip] = useState(0)
  const [filterError, setFilterError] = useState('')
  const [expandedDoc, setExpandedDoc] = useState<unknown | null>(null)

  const collectionsQ = useQuery({
    queryKey: ['db-tooling', databaseId, 'mongo', 'collections'],
    queryFn: () => api.get<QueryResult>(`/databases/${databaseId}/mongo/collections`),
  })

  const collections = collectionsQ.data ? parseCollections(collectionsQ.data) : []

  // Effective collection: user pick if set, otherwise first available.
  const collection = collectionPick || collections[0] || ''

  const onPickCollection = (c: string) => {
    setCollectionPick(c)
    setSkip(0)
    setExecutedSkip(0)
  }

  const findQ = useQuery({
    queryKey: ['db-tooling', databaseId, 'mongo', 'find', collection, executedFilter, executedLimit, executedSkip],
    queryFn: () => {
      const params = new URLSearchParams({
        filter: executedFilter,
        limit: String(executedLimit),
        skip: String(executedSkip),
      })
      return api.get<QueryResult>(
        `/databases/${databaseId}/mongo/collections/${encodeURIComponent(collection)}/find?${params}`,
      )
    },
    enabled: !!collection,
  })

  const docs = findQ.data ? parseDocuments(findQ.data) : []

  const runFind = () => {
    try {
      JSON.parse(filter)
      setFilterError('')
      setExecutedFilter(filter)
      setExecutedLimit(limit)
      setExecutedSkip(skip)
    } catch {
      setFilterError('Filter must be valid JSON')
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      {/* Collections list */}
      <div className="rounded-md border">
        <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          Collections
        </div>
        <div className="max-h-[600px] overflow-auto">
          {collectionsQ.isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {collectionsQ.error && (
            <div className="m-2 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-600">
              {collectionsQ.error instanceof ApiError ? collectionsQ.error.message : 'Failed to load'}
            </div>
          )}
          {!collectionsQ.isLoading && collections.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">No collections</div>
          )}
          {collections.map((c: string) => (
            <button
              key={c}
              type="button"
              onClick={() => onPickCollection(c)}
              className={`block w-full px-3 py-1.5 text-left font-mono text-xs hover:bg-muted ${
                collection === c ? 'bg-muted font-medium' : ''
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Right pane */}
      <div className="space-y-3">
        {!collection ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Select a collection.
          </div>
        ) : (
          <>
            <div className="space-y-2 rounded-md border p-3">
              <div className="space-y-1">
                <Label className="text-xs">Filter (JSON)</Label>
                <textarea
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  className="w-full rounded-md border bg-background p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder='{}'
                />
                {filterError && <p className="text-xs text-red-500">{filterError}</p>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Limit</Label>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={limit}
                    onChange={(e) => setLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 50)))}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Skip</Label>
                  <Input
                    type="number"
                    min={0}
                    value={skip}
                    onChange={(e) => setSkip(Math.max(0, Number(e.target.value) || 0))}
                    className="h-8"
                  />
                </div>
              </div>
              <Button size="sm" className="w-full" onClick={runFind}>
                <Search className="mr-2 h-4 w-4" /> Find
              </Button>
            </div>

            {findQ.isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}

            {findQ.error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">
                {findQ.error instanceof ApiError ? findQ.error.message : 'Failed to load documents'}
              </div>
            )}

            {findQ.data && !findQ.data.success && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">
                {findQ.data.error || 'Find failed'}
              </div>
            )}

            {findQ.data?.success && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">
                  {docs.length} document{docs.length === 1 ? '' : 's'} · {findQ.data.execution_time_ms}ms
                </div>
                {docs.length === 0 && (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No documents matched.
                  </div>
                )}
                <div className="space-y-2">
                  {docs.map((doc, i) => {
                    const id = getDocId(doc)
                    return (
                      <div key={id || i} className="rounded-md border">
                        <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs">
                          <code className="font-mono text-[11px]">{id || `#${i + executedSkip}`}</code>
                          <Button size="sm" variant="ghost" onClick={() => setExpandedDoc(doc)}>
                            View
                          </Button>
                        </div>
                        <pre className="max-h-[200px] overflow-auto p-2 font-mono text-[11px]">
                          {JSON.stringify(doc, null, 2)}
                        </pre>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {expandedDoc != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setExpandedDoc(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Document</h3>
              <Button size="sm" variant="ghost" onClick={() => setExpandedDoc(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <pre className="overflow-auto p-4 font-mono text-xs">
              {JSON.stringify(expandedDoc, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
