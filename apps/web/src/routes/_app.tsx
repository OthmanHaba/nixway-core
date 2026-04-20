import { createFileRoute, Outlet, redirect, Link, useRouter } from '@tanstack/react-router'
import { queryClient } from '@/lib/query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/use-auth'
import { useTeamContext } from '@/hooks/use-team-context'
import { TeamSwitcher } from '@/components/team-switcher'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, User, ChevronDown } from 'lucide-react'
import type { User as UserType } from '@/lib/types'

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    try {
      await queryClient.fetchQuery({
        queryKey: ['auth', 'me'],
        queryFn: () => api.get<UserType>('/auth/me'),
      })
    } catch {
      throw redirect({ to: '/login' })
    }
  },
  component: AppLayout,
})

function AppLayout() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const { currentTeam, teams, setCurrentTeam } = useTeamContext()

  const handleLogout = async () => {
    await logout.mutateAsync()
    router.navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link to="/dashboard" className="text-lg font-bold shrink-0">
              Nixway
            </Link>
            <TeamSwitcher
              currentTeam={currentTeam}
              teams={teams}
              onSelect={setCurrentTeam}
            />
            <nav className="flex items-center gap-4">
              <Link
                to="/dashboard"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                activeProps={{ className: 'text-sm text-foreground font-medium' }}
              >
                Dashboard
              </Link>
              {currentTeam && (
                <>
                  <Link
                    to="/servers/$teamId"
                    params={{ teamId: currentTeam.id }}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    activeProps={{ className: 'text-sm text-foreground font-medium' }}
                  >
                    Servers
                  </Link>
                  <Link
                    to="/clusters/$teamId"
                    params={{ teamId: currentTeam.id }}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    activeProps={{ className: 'text-sm text-foreground font-medium' }}
                  >
                    Clusters
                  </Link>
                  <Link
                    to="/ssh-keys/$teamId"
                    params={{ teamId: currentTeam.id }}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    activeProps={{ className: 'text-sm text-foreground font-medium' }}
                  >
                    SSH Keys
                  </Link>
                  <Link
                    to="/settings/$teamId"
                    params={{ teamId: currentTeam.id }}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    activeProps={{ className: 'text-sm text-foreground font-medium' }}
                  >
                    Settings
                  </Link>
                </>
              )}
              <Link
                to="/teams"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                activeProps={{ className: 'text-sm text-foreground font-medium' }}
              >
                Teams
              </Link>
            </nav>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2">
                <User className="h-4 w-4" />
                <span className="text-sm">{user?.name || user?.email}</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled>
                <span className="text-xs text-muted-foreground">{user?.email}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
