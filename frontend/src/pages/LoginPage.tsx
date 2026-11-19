import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import ThemeToggle from '@/components/ui/ThemeToggle'
import Logo from '@/components/ui/Logo'
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
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', background: 'var(--color-background)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: 'clamp(20px, 4vw, 40px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button type="button" onClick={() => navigate('/')} aria-label="Zephros home" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <Logo size={28} />
          </button>
          <ThemeToggle />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', maxWidth: 400, margin: '0 auto', padding: '48px 0' }}
        >
          <h1 style={{ fontSize: 'clamp(34px, 4vw, 44px)', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.05 }}>
            Welcome <span className="font-display" style={{ fontStyle: 'italic', fontWeight: 400 }}>back.</span>
          </h1>
          <p style={{ fontSize: 15, color: 'var(--color-muted-foreground)', margin: '14px 0 32px', lineHeight: 1.6 }}>
            Sign in to save boards, see your history, and control who can join.
          </p>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={signingIn || loading}
            className="btn btn-lg"
            style={{ width: '100%', background: 'var(--color-card)', borderColor: 'var(--color-border-strong)', color: 'var(--color-foreground)', boxShadow: 'var(--shadow-sm)' }}
          >
            {signingIn ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0', color: 'var(--color-muted-foreground)', fontSize: 13 }}>
            <span style={{ flex: 1, height: 1, background: 'var(--color-border)' }} /> or <span style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
          </div>

          <button type="button" onClick={() => navigate('/')} className="btn btn-ghost btn-lg" style={{ width: '100%' }}>
            Continue as a guest <ArrowRight style={{ width: 16, height: 16 }} />
          </button>
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--color-muted-foreground)', textAlign: 'center' }}>
            Guests can create and join temporary boards.
          </p>

          {!isFirebaseConfigured && (
            <p style={{ marginTop: 24, padding: 12, borderRadius: 12, background: 'var(--color-accent-soft)', fontSize: 13, color: 'var(--color-foreground)', lineHeight: 1.5 }}>
              Google sign-in isn't configured yet. Copy <code>.env.example</code> to <code>.env</code> and add your Firebase keys.
            </p>
          )}
        </motion.div>
      </div>

      {/* Decorative board, hidden on small screens */}
      <div className="hidden lg:block" style={{ padding: 16 }}>
        <div className="canvas-grid" style={{ position: 'relative', height: '100%', borderRadius: 24, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
          {[
            ['var(--color-note-yellow)', 'Ideas worth keeping', '16%', '18%', -4],
            ['var(--color-note-mint)', 'Save to dashboard', '52%', '30%', 3],
            ['var(--color-note-pink)', 'Lock the room', '24%', '56%', 2],
            ['var(--color-note-sky)', 'Invite with a link', '58%', '64%', -3],
          ].map(([bg, text, left, top, rotate], i) => (
            <motion.div key={text as string}
              initial={{ opacity: 0, scale: 0.7, rotate: (rotate as number) - 10 }}
              animate={{ opacity: 1, scale: 1, rotate: rotate as number }}
              transition={{ delay: 0.25 + i * 0.12, type: 'spring', stiffness: 200, damping: 16 }}
              style={{ position: 'absolute', left: left as string, top: top as string, width: '28%', aspectRatio: '1', padding: 20, borderRadius: 8, background: bg as string, color: '#3D2E14', fontWeight: 500, fontSize: 'clamp(14px, 1.3vw, 18px)', boxShadow: '0 10px 24px rgba(24,24,27,0.12)' }}>
              {text as string}
            </motion.div>
          ))}
          <div style={{ position: 'absolute', left: 32, bottom: 28, right: 32 }}>
            <p className="font-display" style={{ fontSize: 'clamp(26px, 2.4vw, 36px)', fontStyle: 'italic', lineHeight: 1.15 }}>From a messy idea to a shared plan, in one link.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
