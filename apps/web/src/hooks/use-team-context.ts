import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { Team } from '@/lib/types'

const STORAGE_KEY = 'nixway_current_team'

export function useTeamContext() {
  const [currentTeamId, setCurrentTeamId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY)
  )

  const { data: teams, isLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: () => api.get<Team[]>('/teams'),
  })

  const currentTeam = teams?.find(t => t.id === currentTeamId) ?? teams?.[0] ?? null

  useEffect(() => {
    if (!currentTeamId && teams && teams.length > 0) {
      setCurrentTeamId(teams[0].id)
    }
  }, [teams, currentTeamId])

  const setCurrentTeam = (teamId: string) => {
    localStorage.setItem(STORAGE_KEY, teamId)
    setCurrentTeamId(teamId)
  }

  return { currentTeam, teams: teams ?? [], setCurrentTeam, isLoading }
}
