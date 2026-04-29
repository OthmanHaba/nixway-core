import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Loader2, ArrowUp, ArrowDown } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { SchemaList, TableList, RowPage } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TableBrowserProps {
  databaseId: string
}

export function TableBrowser({ databaseId }: TableBrowserProps) {
  const [schemaPick, setSchemaPick] = useState<string>('')
  const [table, setTable] = useState<string>('')
  const [page, setPage] = useState(0)
  const [limit, setLimit] = useState(100)
  const [sortCol, setSortCol] = useState<string>('')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  const schemasQ = useQuery({
    queryKey: ['db-tooling', databaseId, 'schemas'],
    queryFn: () => api.get<SchemaList>(`/databases/${databaseId}/schemas`),
  })

  // Effective schema: user pick if set, otherwise the first one available.
  // Derived synchronously so we don't need an effect to seed state.
  const schema = schemaPick || schemasQ.data?.schemas?.[0] || ''

  const onSchemaChange = (next: string) => {
    setSchemaPick(next)
    setTable('')
    setPage(0)
    setSortCol('')
  }

  const tablesQ = useQuery({
    queryKey: ['db-tooling', databaseId, 'tables', schema],
    queryFn: () => api.get<TableList>(`/databases/${databaseId}/schemas/${encodeURIComponent(schema)}/tables`),
    enabled: !!schema,
  })

  const rowsQ = useQuery({
    queryKey: ['db-tooling', databaseId, 'rows', schema, table, page, limit, sortCol, sortOrder],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (sortCol) {
        params.set('sort', sortCol)
        params.set('order', sortOrder)
      }
      return api.get<RowPage>(
        `/databases/${databaseId}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/rows?${params}`,
      )
    },
    enabled: !!schema && !!table,
  })

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortOrder('asc')
    }
    setPage(0)
  }

  const totalPages = (() => {
    if (!rowsQ.data || rowsQ.data.total <= 0) return 0
    return Math.max(1, Math.ceil(rowsQ.data.total / limit))
  })()

  if (schemasQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (schemasQ.error) {
    const msg = schemasQ.error instanceof ApiError ? schemasQ.error.message : 'Failed to load schemas'
    return <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">{msg}</div>
  }

  if (!schemasQ.data?.schemas?.length) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        No schemas available for this database. Make sure it&rsquo;s running and accessible.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Schema</Label>
          <select
            value={schema}
            onChange={(e) => onSchemaChange(e.target.value)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            {schemasQ.data.schemas.map((s: string) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Table</Label>
          <select
            value={table}
            onChange={(e) => { setTable(e.target.value); setPage(0); setSortCol('') }}
            disabled={!tablesQ.data || tablesQ.isLoading}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{tablesQ.isLoading ? 'Loading…' : 'Select a table'}</option>
            {tablesQ.data?.tables?.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Page size</Label>
          <Input
            type="number"
            min={1}
            max={1000}
            value={limit}
            onChange={(e) => {
              const v = Math.min(1000, Math.max(1, Number(e.target.value) || 100))
              setLimit(v)
              setPage(0)
            }}
          />
        </div>
      </div>

      {!table && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Select a table to view its rows.
        </div>
      )}

      {table && rowsQ.isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {table && rowsQ.error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">
          {rowsQ.error instanceof ApiError ? rowsQ.error.message : 'Failed to load rows'}
        </div>
      )}

      {table && rowsQ.data && (
        <div className="space-y-2">
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  {rowsQ.data.columns.map((col) => (
                    <th
                      key={col.name}
                      onClick={() => toggleSort(col.name)}
                      className="cursor-pointer whitespace-nowrap px-3 py-2 text-left font-medium hover:bg-muted/60"
                    >
                      <span className="inline-flex items-center gap-1">
                        <span>{col.name}</span>
                        {col.type_name && (
                          <span className="text-[10px] font-normal text-muted-foreground">{col.type_name}</span>
                        )}
                        {sortCol === col.name && (
                          sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsQ.data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={rowsQ.data.columns.length} className="px-3 py-4 text-center text-muted-foreground">
                      No rows
                    </td>
                  </tr>
                ) : rowsQ.data.rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    {r.values.map((v, j) => (
                      <td key={j} className="px-3 py-1.5 font-mono text-xs">
                        {r.nulls?.[j] ? (
                          <span className="text-muted-foreground italic">NULL</span>
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

          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <div>
              {rowsQ.data.total >= 0
                ? `Page ${page + 1}${totalPages > 0 ? ` of ${totalPages}` : ''} · ${rowsQ.data.total.toLocaleString()} rows`
                : `Page ${page + 1}`}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Input
                type="number"
                min={1}
                value={page + 1}
                onChange={(e) => setPage(Math.max(0, (Number(e.target.value) || 1) - 1))}
                className="h-8 w-16 text-center"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={rowsQ.data.rows.length < limit && (totalPages === 0 || page + 1 >= totalPages)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
