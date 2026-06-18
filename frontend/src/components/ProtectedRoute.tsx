import { Navigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuthStore, useAuthRequired } from '@/stores/authStore'

interface Props {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: Props) {
  const authRequired = useAuthRequired()
  const { user, loading, initialized } = useAuthStore()
  const location = useLocation()
  const [authTimedOut, setAuthTimedOut] = useState(false)

  useEffect(() => {
    if (!authRequired || initialized) return
    const timer = setTimeout(() => setAuthTimedOut(true), 8000)
    return () => clearTimeout(timer)
  }, [authRequired, initialized])

  if (!authRequired) {
    return <>{children}</>
  }

  if ((!initialized || loading) && !authTimedOut) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  return <>{children}</>
}
