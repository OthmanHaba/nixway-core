import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { User } from '@/lib/types'

export function useAuth() {
  const queryClient = useQueryClient()

  const { data: user, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<User>('/auth/me'),
    retry: false,
  })

  const login = useMutation({
    mutationFn: (data: { email: string; password: string }) =>
      api.post<User>('/auth/login', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth'] }),
  })

  const signup = useMutation({
    mutationFn: (data: { email: string; password: string; name: string }) =>
      api.post<User>('/auth/signup', data),
  })

  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => queryClient.clear(),
  })

  return { user, isLoading, login, signup, logout }
}
