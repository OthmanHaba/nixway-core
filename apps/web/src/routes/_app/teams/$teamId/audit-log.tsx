import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from '@tanstack/react-table'
import { api } from '@/lib/api'
import type { AuditLog } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2 } from 'lucide-react'

export const Route = createFileRoute('/_app/teams/$teamId/audit-log')({
  component: AuditLogPage,
})

interface AuditLogResponse {
  logs: AuditLog[]
  next_cursor: string | null
}

const columnHelper = createColumnHelper<AuditLog>()

const columns = [
  columnHelper.accessor('created_at', {
    header: 'Time',
    cell: (info) => (
      <span className="text-muted-foreground text-xs">
        {new Date(info.getValue()).toLocaleString()}
      </span>
    ),
  }),
  columnHelper.accessor('actor_name', {
    header: 'Actor',
    cell: (info) => (
      <div>
        <span className="font-medium">{info.getValue() || 'System'}</span>
        {info.row.original.actor_email && (
          <span className="text-xs text-muted-foreground block">{info.row.original.actor_email}</span>
        )}
      </div>
    ),
  }),
  columnHelper.accessor('action', {
    header: 'Action',
    cell: (info) => <Badge variant="outline">{info.getValue()}</Badge>,
  }),
  columnHelper.accessor('resource_type', {
    header: 'Resource',
    cell: (info) => (
      <span className="text-muted-foreground">
        {info.getValue()}
        {info.row.original.resource_id && (
          <span className="text-xs block">{info.row.original.resource_id}</span>
        )}
      </span>
    ),
  }),
  columnHelper.accessor('ip_address', {
    header: 'IP Address',
    cell: (info) => <span className="text-xs text-muted-foreground font-mono">{info.getValue()}</span>,
  }),
]

function AuditLogPage() {
  const { teamId } = Route.useParams()
  const [actionFilter, setActionFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [allLogs, setAllLogs] = useState<AuditLog[]>([])

  const buildQuery = () => {
    const params = new URLSearchParams()
    if (actionFilter) params.set('action', actionFilter)
    if (actorFilter) params.set('actor', actorFilter)
    if (cursor) params.set('cursor', cursor)
    params.set('limit', '50')
    const qs = params.toString()
    return `/teams/${teamId}/audit-log${qs ? `?${qs}` : ''}`
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['teams', teamId, 'audit-log', actionFilter, actorFilter, cursor],
    queryFn: async () => {
      const result = await api.get<AuditLogResponse>(buildQuery())
      return result
    },
  })

  const logs = cursor ? [...allLogs, ...(data?.logs || [])] : (data?.logs || [])

  const table = useReactTable({
    data: logs,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const handleFilter = () => {
    setCursor(null)
    setAllLogs([])
  }

  const handleLoadMore = () => {
    if (data?.next_cursor) {
      setAllLogs(logs)
      setCursor(data.next_cursor)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Audit Log</h2>
        <p className="text-muted-foreground">Track all activity in this team</p>
      </div>

      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <Input
            placeholder="Filter by action..."
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFilter()}
          />
        </div>
        <div className="flex-1">
          <Input
            placeholder="Filter by actor..."
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFilter()}
          />
        </div>
        <Button variant="outline" onClick={handleFilter}>
          Filter
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No audit log entries found.</p>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead key={header.id}>
                            {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {data?.next_cursor && (
                <div className="flex justify-center mt-4">
                  <Button variant="outline" onClick={handleLoadMore} disabled={isFetching}>
                    {isFetching ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Load More'
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
