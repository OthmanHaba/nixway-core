import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from '@tanstack/react-table'
import { api, ApiError } from '@/lib/api'
import type { Server, SSHKey } from '@/lib/types'
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
import { Loader2, Plus } from 'lucide-react'

export const Route = createFileRoute('/_app/teams/$teamId/servers/')({
  component: ServersPage,
})

function statusBadge(status: string) {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; className?: string }> = {
    online: { variant: 'default', label: 'Online', className: 'bg-green-500 hover:bg-green-500' },
    degraded: { variant: 'default', label: 'Degraded', className: 'bg-yellow-500 hover:bg-yellow-500' },
    offline: { variant: 'destructive', label: 'Offline' },
    provisioning: { variant: 'secondary', label: 'Provisioning' },
  }
  const cfg = variants[status] ?? { variant: 'secondary' as const, label: status }
  return <Badge variant={cfg.variant} className={cfg.className}>{cfg.label}</Badge>
}

function ServersPage() {
  const { teamId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')

  // Step 1 fields
  const [name, setName] = useState('')
  const [hostname, setHostname] = useState('')
  const [sshPort, setSshPort] = useState('22')
  const [sshUser, setSshUser] = useState('root')
  // Step 2 fields
  const [sshKeyId, setSshKeyId] = useState('')

  const { data: servers = [], isLoading } = useQuery({
    queryKey: ['teams', teamId, 'servers'],
    queryFn: () => api.get<Server[]>(`/teams/${teamId}/servers`),
  })

  const { data: sshKeys = [] } = useQuery({
    queryKey: ['teams', teamId, 'ssh-keys'],
    queryFn: () => api.get<SSHKey[]>(`/teams/${teamId}/ssh-keys`),
  })

  const addServer = useMutation({
    mutationFn: (data: {
      name: string; hostname: string; ssh_port: number; ssh_user: string; ssh_key_id: string
    }) => api.post<Server>(`/teams/${teamId}/servers`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'servers'] })
      handleClose()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to add server')
    },
  })

  const handleClose = () => {
    setOpen(false)
    setStep(1)
    setName('')
    setHostname('')
    setSshPort('22')
    setSshUser('root')
    setSshKeyId('')
    setError('')
  }

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setStep(2)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    addServer.mutate({
      name,
      hostname,
      ssh_port: parseInt(sshPort, 10),
      ssh_user: sshUser,
      ssh_key_id: sshKeyId,
    })
  }

  const columnHelper = createColumnHelper<Server>()
  const columns = [
    columnHelper.accessor('name', {
      header: 'Name',
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    columnHelper.accessor('public_ip', {
      header: 'IP',
      cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      cell: (info) => statusBadge(info.getValue()),
    }),
    columnHelper.accessor('os', {
      header: 'OS',
      cell: (info) => {
        const os = info.getValue()
        const osVersion = info.row.original.os_version
        return (
          <span className="text-muted-foreground">
            {os ? `${os}${osVersion ? ` ${osVersion}` : ''}` : '—'}
          </span>
        )
      },
    }),
    columnHelper.accessor('last_seen_at', {
      header: 'Last Seen',
      cell: (info) => {
        const val = info.getValue()
        return (
          <span className="text-muted-foreground">
            {val ? new Date(val).toLocaleString() : 'Never'}
          </span>
        )
      },
    }),
  ]

  const table = useReactTable({
    data: servers,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Servers</h2>
          <p className="text-muted-foreground">Manage your team's servers</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true) }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Server
            </Button>
          </DialogTrigger>
          <DialogContent>
            {step === 1 ? (
              <form onSubmit={handleStep1}>
                <DialogHeader>
                  <DialogTitle>Add Server — Step 1 of 2</DialogTitle>
                  <DialogDescription>Enter server connection details.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                  {error && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="server-name">Name</Label>
                    <Input
                      id="server-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., prod-web-01"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="server-hostname">Hostname / IP</Label>
                    <Input
                      id="server-hostname"
                      value={hostname}
                      onChange={(e) => setHostname(e.target.value)}
                      placeholder="e.g., 192.168.1.100"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ssh-port">SSH Port</Label>
                      <Input
                        id="ssh-port"
                        type="number"
                        value={sshPort}
                        onChange={(e) => setSshPort(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ssh-user">SSH User</Label>
                      <Input
                        id="ssh-user"
                        value={sshUser}
                        onChange={(e) => setSshUser(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit">Next</Button>
                </DialogFooter>
              </form>
            ) : (
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>Add Server — Step 2 of 2</DialogTitle>
                  <DialogDescription>Select an SSH key for authentication.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                  {error && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="ssh-key">SSH Key</Label>
                    <Select value={sshKeyId} onValueChange={setSshKeyId} required>
                      <SelectTrigger id="ssh-key">
                        <SelectValue placeholder="Select a key..." />
                      </SelectTrigger>
                      <SelectContent>
                        {sshKeys.map((key) => (
                          <SelectItem key={key.id} value={key.id}>
                            {key.name} ({key.key_type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {sshKeys.length === 0 && (
                      <p className="text-sm text-muted-foreground">No SSH keys available. Generate one first.</p>
                    )}
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>Back</Button>
                  <Button type="submit" disabled={addServer.isPending || !sshKeyId}>
                    {addServer.isPending ? 'Adding...' : 'Add Server'}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No servers yet. Add your first server to get started.</p>
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
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() =>
                    navigate({
                      to: '/teams/$teamId/servers/$serverId',
                      params: { teamId, serverId: row.original.id },
                    })
                  }
                >
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
