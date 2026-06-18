import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { User, LogOut, LayoutGrid, Pencil, ChevronDown, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { isFirebaseConfigured } from '@/lib/firebase'
import { api } from '@/services/api'
import { socketService } from '@/services/socket'

export default function AccountMenu() {
  const navigate = useNavigate()
  const { user, signInWithGoogle, signOut } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [saving, setSaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (user) setNameValue(user.displayName)
  }, [user])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
        setEditingName(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (!isFirebaseConfigured) return null

  const handleSignIn = async () => {
    try {
      await signInWithGoogle()
      toast.success('Signed in!')
      setOpen(false)
    } catch (err) {
      toast.error((err as Error).message || 'Sign in failed')
    }
  }

  const handleSignOut = async () => {
    await signOut()
    setOpen(false)
    toast.success('Signed out')
    navigate('/')
  }

  const handleSaveName = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed) {
      toast.error('Username cannot be empty')
      return
    }
    setSaving(true)
    const res = await api.updateProfile({ displayName: trimmed })
    setSaving(false)
    if (res.success && res.data) {
      useAuthStore.setState({
        user: {
          uid: res.data.uid,
          email: res.data.email,
          displayName: res.data.displayName,
          photoURL: res.data.photoURL,
        },
      })
      socketService.username = res.data.displayName
      setEditingName(false)
      setOpen(false)
      toast.success('Username updated')
    } else {
      toast.error(res.error || 'Failed to update username')
    }
  }

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 max-w-[160px] items-center gap-2 rounded-xl border border-border bg-surface-1 px-2 sm:px-3 text-foreground cursor-pointer hover:bg-surface-2 transition-colors"
      >
        {user?.photoURL ? (
          <img src={user.photoURL} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent">
            <User className="h-3.5 w-3.5 text-white" />
          </div>
        )}
        <span className="hidden truncate text-sm font-medium sm:block">
          {user ? user.displayName.split(' ')[0] : 'Sign in'}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-[calc(100%+8px)] z-[200] w-72 overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
          >
            {!user ? (
              <div className="p-4">
                <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
                  Sign in to create boards, save history, and use your name on the canvas.
                </p>
                <button
                  type="button"
                  onClick={handleSignIn}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-1 text-sm font-semibold cursor-pointer hover:bg-surface-2"
                >
                  <LogIn className="h-4 w-4" />
                  Sign in with Google
                </button>
              </div>
            ) : (
              <>
                <div className="border-b border-border p-4">
                  <div className="flex items-center gap-3">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">
                        {user.displayName.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{user.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                </div>

                <div className="p-2">
                  <MenuItem icon={LayoutGrid} label="My Boards" onClick={() => { setOpen(false); navigate('/dashboard') }} />
                  <MenuItem icon={Pencil} label="Change username" onClick={() => setEditingName(true)} />
                </div>

                {editingName && (
                  <div className="border-t border-border px-4 pb-4 pt-3">
                    <input
                      value={nameValue}
                      onChange={(e) => setNameValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                      placeholder="Display name"
                      className="h-9 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm outline-none focus:border-accent"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveName}
                        disabled={saving}
                        className="h-8 flex-1 rounded-lg bg-accent text-xs font-semibold text-white border-none cursor-pointer disabled:opacity-70"
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditingName(false); setNameValue(user.displayName) }}
                        className="h-8 flex-1 rounded-lg border border-border bg-transparent text-xs cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div className="border-t border-border p-2">
                  <MenuItem icon={LogOut} label="Sign out" onClick={handleSignOut} danger />
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }: {
  icon: typeof User
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium border-none cursor-pointer transition-colors hover:bg-muted ${
        danger ? 'text-destructive' : 'text-foreground'
      }`}
    >
      <Icon className="h-4 w-4 opacity-70" />
      {label}
    </button>
  )
}
