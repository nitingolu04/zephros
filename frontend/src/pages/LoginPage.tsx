import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sparkles, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { useAuthStore } from '@/stores/authStore'
import { isFirebaseConfigured } from '@/lib/firebase'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, signInWithGoogle, loading } = useAuthStore()
  const [signingIn, setSigningIn] = useState(false)

  const redirectTo = searchParams.get('redirect') || '/'

  useEffect(() => {
    if (user) {
      navigate(redirectTo, { replace: true })
    }
  }, [user, navigate, redirectTo])

  const handleGoogleSignIn = async () => {
    if (!isFirebaseConfigured) {
      toast.error('Firebase is not configured. Add VITE_FIREBASE_* keys to your .env file.')
      return
    }
    setSigningIn(true)
    try {
      await signInWithGoogle()
      toast.success('Signed in successfully')
      navigate(redirectTo, { replace: true })
    } catch (err) {
      toast.error((err as Error).message || 'Sign in failed')
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-background)' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 20 }}>
        <ThemeToggle />
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{
            width: '100%',
            maxWidth: 420,
            borderRadius: 20,
            border: '1px solid var(--color-border)',
            background: 'color-mix(in srgb, var(--color-card) 70%, transparent)',
            backdropFilter: 'blur(12px)',
            padding: 40,
            textAlign: 'center',
            boxShadow: '0 20px 50px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{
            width: 56, height: 56, borderRadius: 16, margin: '0 auto 20px',
            background: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 30px rgba(99,102,241,0.35)',
          }}>
            <Sparkles style={{ width: 28, height: 28, color: 'white' }} />
          </div>

          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Welcome to Aerix</h1>
          <p style={{ fontSize: 14, color: 'var(--color-muted-foreground)', marginBottom: 32, lineHeight: 1.6 }}>
            Sign in with Google to create boards, collaborate in real time, and chat with your team.
          </p>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleGoogleSignIn}
            disabled={signingIn || loading}
            style={{
              display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'center', gap: 12,
              height: 52, borderRadius: 14, border: '1px solid var(--color-border)',
              background: 'var(--color-surface-1)', fontSize: 15, fontWeight: 600,
              color: 'var(--color-foreground)', cursor: signingIn ? 'wait' : 'pointer',
              opacity: signingIn ? 0.7 : 1,
            }}
          >
            {signingIn ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span>Continue with Google</span>
                <ArrowRight style={{ width: 18, height: 18, opacity: 0.6 }} />
              </>
            )}
          </motion.button>

          <button
            onClick={() => navigate('/')}
            style={{ marginTop: 16, background: 'none', border: 'none', fontSize: 13, color: 'var(--color-muted-foreground)', cursor: 'pointer' }}
          >
            ← Back to homepage
          </button>

          {!isFirebaseConfigured && (
            <p style={{ marginTop: 20, fontSize: 12, color: '#F59E0B', lineHeight: 1.5 }}>
              Firebase env vars are missing. Copy <code>.env.example</code> to <code>.env</code> and add your Firebase config to enable sign-in.
            </p>
          )}
        </motion.div>
      </div>
    </div>
  )
}
