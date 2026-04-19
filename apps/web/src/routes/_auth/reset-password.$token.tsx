import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle } from 'lucide-react'

export const Route = createFileRoute('/_auth/reset-password/$token')({
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = Route.useParams()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const resetPassword = useMutation({
    mutationFn: (data: { token: string; password: string }) =>
      api.post('/auth/reset-password', data),
    onSuccess: () => setSuccess(true),
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message)
      else setError('An unexpected error occurred')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    resetPassword.mutate({ token, password })
  }

  if (success) {
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Password reset</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <CheckCircle className="h-12 w-12 text-green-500" />
          <p className="text-center">Your password has been reset successfully.</p>
        </CardContent>
        <CardFooter>
          <Link to="/login" className="w-full">
            <Button className="w-full">Sign in</Button>
          </Link>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Set new password</CardTitle>
        <CardDescription>Enter your new password below</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={resetPassword.isPending}>
            {resetPassword.isPending ? 'Resetting...' : 'Reset password'}
          </Button>
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Back to sign in
          </Link>
        </CardFooter>
      </form>
    </Card>
  )
}
