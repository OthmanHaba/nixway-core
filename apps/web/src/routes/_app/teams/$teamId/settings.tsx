import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { Team, TeamInvite } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Trash2 } from 'lucide-react'

export const Route = createFileRoute('/_app/teams/$teamId/settings')({
  component: TeamSettingsPage,
})

function TeamSettingsPage() {
  const { teamId } = Route.useParams()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: team } = useQuery({
    queryKey: ['teams', teamId],
    queryFn: () => api.get<Team>(`/teams/${teamId}`),
  })

  const [teamName, setTeamName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')

  // Sync team name when loaded
  useState(() => {
    if (team) setTeamName(team.name)
  })

  const { data: invites = [], isLoading: invitesLoading } = useQuery({
    queryKey: ['teams', teamId, 'invites'],
    queryFn: () => api.get<TeamInvite[]>(`/teams/${teamId}/invites`),
  })

  const updateTeam = useMutation({
    mutationFn: (data: { name: string }) => api.put<Team>(`/teams/${teamId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      toast({ title: 'Team updated', description: 'Team name has been updated.' })
    },
    onError: (err) => {
      toast({ variant: 'destructive', title: 'Error', description: err instanceof ApiError ? err.message : 'Failed to update team' })
    },
  })

  const createInvite = useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      api.post<TeamInvite>(`/teams/${teamId}/invites`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'invites'] })
      setInviteEmail('')
      setInviteRole('member')
      toast({ title: 'Invite sent', description: 'An invitation has been sent.' })
    },
    onError: (err) => {
      toast({ variant: 'destructive', title: 'Error', description: err instanceof ApiError ? err.message : 'Failed to send invite' })
    },
  })

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) => api.delete(`/teams/${teamId}/invites/${inviteId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', teamId, 'invites'] })
      toast({ title: 'Invite revoked' })
    },
  })

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault()
    updateTeam.mutate({ name: teamName })
  }

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault()
    createInvite.mutate({ email: inviteEmail, role: inviteRole })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Team Settings</h2>
        <p className="text-muted-foreground">Manage your team configuration</p>
      </div>

      <Card>
        <form onSubmit={handleRename}>
          <CardHeader>
            <CardTitle>Team Name</CardTitle>
            <CardDescription>Update your team's display name</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="team-name">Name</Label>
              <Input
                id="team-name"
                value={teamName || team?.name || ''}
                onChange={(e) => setTeamName(e.target.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={updateTeam.isPending}>
              {updateTeam.isPending ? 'Saving...' : 'Save'}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Invite Members</CardTitle>
          <CardDescription>Send invitations to join this team</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleInvite} className="flex gap-3 items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div className="w-32 space-y-2">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={createInvite.isPending}>
              {createInvite.isPending ? 'Sending...' : 'Send Invite'}
            </Button>
          </form>

          <Separator />

          <div>
            <h4 className="text-sm font-medium mb-3">Pending Invites</h4>
            {invitesLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : invites.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No pending invites</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Invited by</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell className="font-medium">{invite.email}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{invite.role}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{invite.inviter_name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(invite.expires_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => revokeInvite.mutate(invite.id)}
                            disabled={revokeInvite.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
