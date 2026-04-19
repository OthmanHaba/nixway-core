import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { queryClient } from '@/lib/query'
import { api } from '@/lib/api'
import type { User } from '@/lib/types'

export const Route = createFileRoute('/_auth')({
  beforeLoad: async () => {
    try {
      await queryClient.fetchQuery({
        queryKey: ['auth', 'me'],
        queryFn: () => api.get<User>('/auth/me'),
      })
      throw redirect({ to: '/dashboard' })
    } catch (e) {
      if (e instanceof Response || (e && typeof e === 'object' && 'to' in e)) throw e
      // Not authenticated, continue to auth pages
    }
  },
  component: AuthLayout,
})

function AuthLayout() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <Outlet />
      </div>
    </div>
  )
}
