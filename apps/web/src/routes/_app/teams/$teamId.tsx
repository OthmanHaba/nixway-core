import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from '@tanstack/react-table'
import { api } from '@/lib/api'
import type { Team, TeamMember } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
// Tabs available for future use
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Settings, Key, ScrollText, Loader2 } from 'lucide-react'

export const Route = createFileRoute('/_app/teams/$teamId')({
  component: TeamDetailPage,
})

const memberColumnHelper = createColumnHelper<TeamMember>()

const memberColumns = [
  memberColumnHelper.accessor('user_name', {
    header: 'Name',
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  memberColumnHelper.accessor('email', {
    header: 'Email',
    cell: (info) => <span className="text-muted-foreground">{info.getValue()}</span>,
  }),
  memberColumnHelper.accessor('role', {
    header: 'Role',
    cell: (info) => (
      <Badge variant={info.getValue() === 'owner' ? 'default' : 'secondary'}>
        {info.getValue()}
      </Badge>
    ),
  }),
  memberColumnHelper.accessor('created_at', {
    header: 'Joined',
    cell: (info) => new Date(info.getValue()).toLocaleDateString(),
  }),
]

function TeamDetailPage() {
  const { teamId } = Route.useParams()

  const { data: team, isLoading: teamLoading } = useQuery({
    queryKey: ['teams', teamId],
    queryFn: () => api.get<Team>(`/teams/${teamId}`),
  })

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['teams', teamId, 'members'],
    queryFn: () => api.get<TeamMember[]>(`/teams/${teamId}/members`),
  })

  const memberTable = useReactTable({
    data: members,
    columns: memberColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  if (teamLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{team?.name}</h1>
          <p className="text-muted-foreground">/{team?.slug}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/teams/$teamId/settings" params={{ teamId }}>
            <Button variant="outline" size="sm">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          </Link>
          <Link to="/teams/$teamId/tokens" params={{ teamId }}>
            <Button variant="outline" size="sm">
              <Key className="mr-2 h-4 w-4" />
              API Tokens
            </Button>
          </Link>
          <Link to="/teams/$teamId/audit-log" params={{ teamId }}>
            <Button variant="outline" size="sm">
              <ScrollText className="mr-2 h-4 w-4" />
              Audit Log
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>{members.length} member{members.length !== 1 ? 's' : ''}</CardDescription>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  {memberTable.getHeaderGroups().map((headerGroup) => (
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
                  {memberTable.getRowModel().rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={memberColumns.length} className="text-center py-8 text-muted-foreground">
                        No members found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    memberTable.getRowModel().rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
