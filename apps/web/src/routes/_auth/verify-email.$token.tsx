import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

export const Route = createFileRoute('/_auth/verify-email/$token')({
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { token } = Route.useParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    api.post('/auth/verify-email', { token })
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error')
        setErrorMsg(err instanceof ApiError ? err.message : 'Verification failed')
      })
  }, [token])

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Email Verification</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {status === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Verifying your email...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="h-12 w-12 text-green-500" />
            <p className="text-center">Your email has been verified successfully.</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-destructive" />
            <p className="text-center text-destructive">{errorMsg}</p>
          </>
        )}
      </CardContent>
      <CardFooter>
        <Link to="/login" className="w-full">
          <Button className="w-full">Go to sign in</Button>
        </Link>
      </CardFooter>
    </Card>
  )
}
