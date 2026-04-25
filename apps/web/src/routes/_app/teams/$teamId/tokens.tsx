import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from '@tanstack/react-table'
import { api, ApiError } from '@/lib/api'
import type { APIToken } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { Plus, Loader2, Copy, Trash2, ShieldCheck } from 'lucide-react'

export const Route = createFileRoute('/_app/teams/$teamId/tokens')({
  component: TokensPage,
})

const READ_SCOPES = ['teams:read', 'members:read', 'invites:read', 'tokens:read', 'audit:read', 'servers:read']
const DEPLOY_SCOPES = ['teams:read', 'servers:read', 'servers:write']

const TOKEN_SCOPE_OPTIONS = [
  { value: 'teams:read', label: 'Read teams' },
  { value: 'teams:write', label: 'Manage teams' },
  { value: 'members:read', label: 'Read members' },
  { value: 'members:write', label: 'Manage members' },
  { value: 'invites:read', label: 'Read invites' },
  { value: 'invites:write', label: 'Manage invites' },
  { value: 'tokens:read', label: 'Read tokens' },
  { value: 'tokens:write', label: 'Manage tokens' },
  { value: 'audit:read', label: 'Read audit logs' },
  { value: 'servers:read', label: 'Read servers' },
  { value: 'servers:write', label: 'Manage servers' },
]

function TokensPage() {
  const { teamId } = Route.useParams()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [tokenName, setTokenName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>(READ_SCOPES)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [error, setError] = useState('')

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['teams', teamId, 'tokens'],
    queryFn: () => api.get<APIToken[]>(`/teams/${teamId}/tokens`),
  })

  const createToken = useMutation({
    mutationFn: (data: { name: string; scopes: string[] }) =>
      api.post<APIToken>(`/teams/${teamId}/tokens`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'tokens'] })
      setNewToken(data.token || null)
      setTokenName('')
      setSelectedScopes(READ_SCOPES)
      setError('')
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to create token')
    },
  })

  const revokeToken = useMutation({
    mutationFn: (tokenId: string) => api.delete(`/teams/${teamId}/tokens/${tokenId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'tokens'] })
      toast({ title: 'Token revoked' })
    },
  })

  const columnHelper = createColumnHelper<APIToken>()
  const columns = [
    columnHelper.accessor('name', {
      header: 'Name',
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    columnHelper.accessor('scopes', {
      header: 'Scopes',
      cell: (info) => (
        <div className="flex gap-1 flex-wrap">
          {(info.getValue() || []).map((scope) => (
            <Badge key={scope} variant="secondary" className="text-xs">{scope}</Badge>
          ))}
        </div>
      ),
    }),
    columnHelper.accessor('last_used_at', {
      header: 'Last Used',
      cell: (info) => {
        const val = info.getValue()
        return <span className="text-muted-foreground">{val ? new Date(val).toLocaleDateString() : 'Never'}</span>
      },
    }),
    columnHelper.accessor('created_at', {
      header: 'Created',
      cell: (info) => <span className="text-muted-foreground">{new Date(info.getValue()).toLocaleDateString()}</span>,
    }),
    columnHelper.display({
      id: 'actions',
      cell: (info) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => revokeToken.mutate(info.row.original.id)}
          disabled={revokeToken.isPending}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      ),
    }),
  ]

  const table = useReactTable({
    data: tokens,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (selectedScopes.length === 0) {
      setError('Select at least one scope.')
      return
    }
    createToken.mutate({ name: tokenName, scopes: selectedScopes })
  }

  const handleCopyToken = () => {
    if (newToken) {
      navigator.clipboard.writeText(newToken)
      toast({ title: 'Copied', description: 'Token copied to clipboard.' })
    }
  }

  const handleCloseDialog = (isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      setNewToken(null)
      setError('')
      setSelectedScopes(READ_SCOPES)
    }
  }

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) => {
      const withoutFullAccess = prev.filter((s) => s !== '*')
      if (withoutFullAccess.includes(scope)) {
        return withoutFullAccess.filter((s) => s !== scope)
      }
      return [...withoutFullAccess, scope]
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">API Tokens</h2>
          <p className="text-muted-foreground">Manage API tokens for programmatic access</p>
        </div>
        <Dialog open={open} onOpenChange={handleCloseDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Token
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            {newToken ? (
              <>
                <DialogHeader>
                  <DialogTitle>Token Created</DialogTitle>
                  <DialogDescription>
                    Copy this token now. You will not be able to see it again.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <div className="flex gap-2">
                    <Input value={newToken} readOnly className="font-mono text-xs" />
                    <Button variant="outline" size="icon" onClick={handleCopyToken}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => handleCloseDialog(false)}>Done</Button>
                </DialogFooter>
              </>
            ) : (
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Create API Token</DialogTitle>
                  <DialogDescription>Create a new token with only the permissions it needs.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                  {error && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="token-name">Token name</Label>
                    <Input
                      id="token-name"
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                      placeholder="e.g., CI/CD Pipeline"
                      required
                    />
                  </div>
                  <div className="space-y-3">
                    <Label>Scopes</Label>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setSelectedScopes(READ_SCOPES)}>
                        Read-only
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setSelectedScopes(DEPLOY_SCOPES)}>
                        Server deploy
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setSelectedScopes(['*'])}>
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        Full access
                      </Button>
                    </div>
                    {selectedScopes.includes('*') ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        This token will have full access to this team.
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {TOKEN_SCOPE_OPTIONS.map((scope) => (
                          <label
                            key={scope.value}
                            className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={selectedScopes.includes(scope.value)}
                              onChange={() => toggleScope(scope.value)}
                              className="h-4 w-4"
                            />
                            <span>
                              <span className="font-medium">{scope.label}</span>
                              <span className="ml-2 font-mono text-xs text-muted-foreground">{scope.value}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createToken.isPending}>
                    {createToken.isPending ? 'Creating...' : 'Create'}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tokens.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No API tokens yet.</p>
          ) : (
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}
