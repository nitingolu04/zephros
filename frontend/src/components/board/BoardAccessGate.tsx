import { useState, type CSSProperties } from 'react'
import { Lock, LogIn, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'

const shell: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  padding: 24,
  background: 'var(--color-background, #F8FAFC)',
  textAlign: 'center',
}

interface Props {
  boardId: string
  reason: 'auth' | 'password' | 'locked'
  boardTitle?: string
  onUnlocked: (password?: string) => void
}

export default function BoardAccessGate({ boardId, reason, boardTitle, onUnlocked }: Props) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const signIn = useAuthStore((s) => s.signInWithGoogle)

  const handlePassword = async () => {
    if (!password.trim()) return
    setLoading(true)
    const res = await api.verifyBoardAccess(boardId, password.trim())
    setLoading(false)
    if (res.success) {
      sessionStorage.setItem(`aerix_board_pwd_${boardId}`, password.trim())
      onUnlocked(password.trim())
    } else {
      toast.error('Incorrect password')
    }
  }

  if (reason === 'locked') {
    return (
      <div style={shell}>
        <div style={{
          width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(239,68,68,0.12)', color: '#EF4444',
        }}
        >
          <ShieldOff style={{ width: 28, height: 28 }} />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A' }}>{boardTitle || 'Board locked'}</h1>
        <p style={{ fontSize: 14, color: '#64748B', maxWidth: 360 }}>
          The host has locked this board. New participants cannot join right now.
        </p>
      </div>
    )
  }

  if (reason === 'auth') {
    return (
      <div style={shell}>
        <div style={{
          width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(99,102,241,0.15)', color: '#6366F1',
        }}
        >
          <LogIn style={{ width: 28, height: 28 }} />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A' }}>{boardTitle || 'Private board'}</h1>
        <p style={{ fontSize: 14, color: '#64748B', maxWidth: 360 }}>
          This board requires you to sign in before joining.
        </p>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              try {
                await signIn()
                for (let i = 0; i < 10; i++) {
                  const token = await useAuthStore.getState().getIdToken()
                  if (token) break
                  await new Promise((r) => setTimeout(r, 300))
                }
                onUnlocked()
              } catch {
                toast.error('Sign in failed')
              }
            })()
          }}
          style={{
            borderRadius: 12, border: 'none', padding: '10px 20px',
            background: '#6366F1', color: 'white', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Sign in with Google
        </button>
      </div>
    )
  }

  return (
    <div style={shell}>
      <div style={{
        width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(99,102,241,0.15)', color: '#6366F1',
      }}
      >
        <Lock style={{ width: 28, height: 28 }} />
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A' }}>{boardTitle || 'Protected board'}</h1>
      <p style={{ fontSize: 14, color: '#64748B', maxWidth: 360 }}>Enter the board password to continue.</p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void handlePassword() }}
        placeholder="Board password"
        style={{
          width: '100%', maxWidth: 320, borderRadius: 12, border: '1px solid #E2E8F0',
          background: '#FFFFFF', padding: '10px 14px', fontSize: 14, outline: 'none',
        }}
      />
      <button
        type="button"
        disabled={loading}
        onClick={() => { void handlePassword() }}
        style={{
          borderRadius: 12, border: 'none', padding: '10px 20px',
          background: '#6366F1', color: 'white', fontWeight: 600,
          cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Checking…' : 'Join board'}
      </button>
    </div>
  )
}
