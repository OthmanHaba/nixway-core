import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/github/callback')({
  component: GitHubCallbackPage,
})

function GitHubCallbackPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')
  const exchanged = useRef(false)

  useEffect(() => {
    // Prevent double execution (React Strict Mode re-runs effects in dev)
    if (exchanged.current) return
    exchanged.current = true

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')

    // The team ID is stored in localStorage before redirect
    const teamId = localStorage.getItem('nixway_github_team_id')

    if (!code) {
      setStatus('error')
      setError('No code received from GitHub')
      return
    }

    if (!teamId) {
      setStatus('error')
      setError('Team context lost. Please try again from Settings.')
      return
    }

    api.post(`/teams/${teamId}/github/callback`, { code })
      .then(() => {
        setStatus('success')
        localStorage.removeItem('nixway_github_team_id')
        setTimeout(() => {
          navigate({ to: '/settings/$teamId', params: { teamId } })
        }, 2000)
      })
      .catch((err) => {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Failed to connect GitHub App')
      })
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        {status === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mx-auto" />
            <h2 className="text-xl font-semibold">Connecting GitHub App...</h2>
            <p className="text-muted-foreground">Exchanging credentials with GitHub</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-semibold">GitHub App Connected!</h2>
            <p className="text-muted-foreground">Redirecting to settings...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto" />
            <h2 className="text-xl font-semibold">Connection Failed</h2>
            <p className="text-muted-foreground">{error}</p>
            <Button
              variant="outline"
              onClick={() => navigate({ to: '/dashboard' })}
            >
              Back to Dashboard
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
