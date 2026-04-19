import { useRouter } from '@tanstack/react-router'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ChevronDown, Users } from 'lucide-react'
import type { Team } from '@/lib/types'

interface TeamSwitcherProps {
  currentTeam: Team | null
  teams: Team[]
  onSelect: (teamId: string) => void
}

export function TeamSwitcher({ currentTeam, teams, onSelect }: TeamSwitcherProps) {
  const router = useRouter()

  const handleSelect = (teamId: string) => {
    onSelect(teamId)
    router.navigate({ to: '/dashboard' })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 max-w-[180px]">
          <Users className="h-4 w-4 shrink-0" />
          <span className="truncate text-sm">
            {currentTeam ? currentTeam.name : 'Select team'}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px]">
        {teams.length === 0 ? (
          <DropdownMenuItem disabled>No teams</DropdownMenuItem>
        ) : (
          teams.map((team, index) => (
            <div key={team.id}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={() => handleSelect(team.id)}
                className={currentTeam?.id === team.id ? 'font-medium' : ''}
              >
                {team.name}
              </DropdownMenuItem>
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
