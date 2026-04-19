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
import { Plus, Loader2, Copy, Trash2 } from 'lucide-react'

export const Route = createFileRoute('/_app/teams/$teamId/tokens')({
  component: TokensPage,
})

function TokensPage() {
  const { teamId } = Route.useParams()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [tokenName, setTokenName] = useState('')
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
    createToken.mutate({ name: tokenName, scopes: ['*'] })
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
    }
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
          <DialogContent>
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
                  <DialogDescription>Create a new token for API access.</DialogDescription>
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
