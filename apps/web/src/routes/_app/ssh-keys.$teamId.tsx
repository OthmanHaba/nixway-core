import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from '@tanstack/react-table'
import { api, ApiError } from '@/lib/api'
import type { SSHKey } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Plus, Loader2, Trash2 } from 'lucide-react'

export const Route = createFileRoute('/_app/ssh-keys/$teamId')({
  component: SSHKeysPage,
})

function SSHKeysPage() {
  const { teamId } = Route.useParams()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [keyType, setKeyType] = useState('ed25519')
  const [error, setError] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['teams', teamId, 'ssh-keys'],
    queryFn: () => api.get<SSHKey[]>(`/teams/${teamId}/ssh-keys`),
  })

  const generateKey = useMutation({
    mutationFn: (data: { name: string; key_type: string }) =>
      api.post<SSHKey>(`/teams/${teamId}/ssh-keys`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'ssh-keys'] })
      setOpen(false)
      setKeyName('')
      setKeyType('ed25519')
      setError('')
      toast({ title: 'SSH key generated', description: 'The new key has been created.' })
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to generate key')
    },
  })

  const deleteKey = useMutation({
    mutationFn: (keyId: string) => api.delete(`/teams/${teamId}/ssh-keys/${keyId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'ssh-keys'] })
      setDeleteId(null)
      toast({ title: 'SSH key deleted' })
    },
  })

  const columnHelper = createColumnHelper<SSHKey>()
  const columns = [
    columnHelper.accessor('name', {
      header: 'Name',
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    columnHelper.accessor('key_type', {
      header: 'Type',
      cell: (info) => <Badge variant="secondary">{info.getValue()}</Badge>,
    }),
    columnHelper.accessor('fingerprint', {
      header: 'Fingerprint',
      cell: (info) => (
        <span className="font-mono text-xs text-muted-foreground">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor('created_at', {
      header: 'Created',
      cell: (info) => (
        <span className="text-muted-foreground">{new Date(info.getValue()).toLocaleDateString()}</span>
      ),
    }),
    columnHelper.display({
      id: 'actions',
      cell: (info) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDeleteId(info.row.original.id)}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      ),
    }),
  ]

  const table = useReactTable({
    data: keys,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    generateKey.mutate({ name: keyName, key_type: keyType })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">SSH Keys</h2>
          <p className="text-muted-foreground">Manage SSH keys for server access</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Generate Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleGenerate}>
              <DialogHeader>
                <DialogTitle>Generate SSH Key</DialogTitle>
                <DialogDescription>Generate a new SSH key pair for server access.</DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-4">
                {error && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="key-name">Key name</Label>
                  <Input
                    id="key-name"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="e.g., production-key"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="key-type">Key type</Label>
                  <Select value={keyType} onValueChange={setKeyType}>
                    <SelectTrigger id="key-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ed25519">ed25519</SelectItem>
                      <SelectItem value="rsa">rsa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={generateKey.isPending}>
                  {generateKey.isPending ? 'Generating...' : 'Generate'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete SSH Key</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this SSH key? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteKey.isPending}
              onClick={() => deleteId && deleteKey.mutate(deleteId)}
            >
              {deleteKey.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : keys.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No SSH keys yet. Generate your first key to get started.</p>
        </div>
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
    </div>
  )
}
