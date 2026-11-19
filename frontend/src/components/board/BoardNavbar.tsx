import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { PanelRightClose, PanelRightOpen, Share2, Pencil, Check, X, Bookmark, Circle, Presentation, Lock, UserX, MicOff, ChevronDown, Eye } from 'lucide-react'
import SharePopover from '@/components/board/SharePopover'
import { toast } from 'sonner'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { useBoardStore } from '@/stores/boardStore'
import { useAuthStore } from '@/stores/authStore'
import { socketService } from '@/services/socket'
import { useNavigate } from 'react-router-dom'
import { generateId } from '@/lib/utils'
import { api } from '@/services/api'
import { useRecorder } from '@/hooks/useRecorder'
import { LogoMark } from '@/components/ui/Logo'

interface Props {
  boardTitle: string
  boardId: string
  onToggleRightSidebar: () => void
  rightSidebarOpen: boolean
  canvasContainerRef?: React.RefObject<HTMLDivElement | null>
  onTogglePresentation?: () => void
  presentationOpen?: boolean
}

export default function BoardNavbar({
  boardTitle, boardId, onToggleRightSidebar, rightSidebarOpen, canvasContainerRef,
  onTogglePresentation, presentationOpen,
}: Props) {
  const activeUsers = useBoardStore((s) => s.activeUsers)
  const board = useBoardStore((s) => s.board)
  const setBoard = useBoardStore((s) => s.setBoard)
  const addActivityEvent = useBoardStore((s) => s.addActivityEvent)
  const authUser = useAuthStore((s) => s.user)
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)
  const navigate = useNavigate()
  const { recording, elapsed, toggleRecording } = useRecorder(canvasContainerRef ?? { current: null })

  const isSignedIn = Boolean(authUser?.uid)
  const isOwner = Boolean(board?.ownerUid && authUser?.uid && board.ownerUid === authUser.uid)
  // Signed-in user on a board with no host yet can claim ownership via Security → Save
  const canManageSecurity = isSignedIn && (isOwner || !board?.ownerUid)
  const hasOtherHost = Boolean(board?.ownerUid && !isOwner)

  const securityRef = useRef<HTMLDivElement>(null)
  const shareRef = useRef<HTMLButtonElement>(null)
  const [showShare, setShowShare] = useState(false)
  const myRole = useBoardStore((s) => s.myRole)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(boardTitle)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const [editingUsername, setEditingUsername] = useState(false)
  const [usernameValue, setUsernameValue] = useState(socketService.username)
  const usernameInputRef = useRef<HTMLInputElement>(null)

  const [menuUserId, setMenuUserId] = useState<string | null>(null)
  const [showSecurity, setShowSecurity] = useState(false)
  const [requireAuth, setRequireAuth] = useState(Boolean(board?.requireAuth))
  const [isLocked, setIsLocked] = useState(Boolean(board?.isLocked))
  const [newPassword, setNewPassword] = useState('')
  const [savingSecurity, setSavingSecurity] = useState(false)
  const [securityMenuPos, setSecurityMenuPos] = useState({ top: 0, left: 0 })

  useEffect(() => { setTitleValue(boardTitle) }, [boardTitle])
  useEffect(() => { setRequireAuth(Boolean(board?.requireAuth)) }, [board?.requireAuth])
  useEffect(() => { setIsLocked(Boolean(board?.isLocked)) }, [board?.isLocked])
  useEffect(() => { if (editingTitle && titleInputRef.current) { titleInputRef.current.focus(); titleInputRef.current.select() } }, [editingTitle])
  useEffect(() => { if (editingUsername && usernameInputRef.current) { usernameInputRef.current.focus(); usernameInputRef.current.select() } }, [editingUsername])

  useEffect(() => {
    if (!showSecurity) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (securityRef.current?.contains(target)) return
      if ((target as Element).closest?.('[data-security-menu]')) return
      setShowSecurity(false)
    }
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [showSecurity])

  const toggleSecurityMenu = () => {
    if (securityRef.current) {
      const rect = securityRef.current.getBoundingClientRect()
      setSecurityMenuPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - 300) })
    }
    setShowSecurity((open) => !open)
  }

  const saveTitle = async () => {
    const newTitle = titleValue.trim() || 'Untitled Board'
    const previous = board?.title || 'Untitled Board'
    setTitleValue(newTitle)
    setEditingTitle(false)
    if (newTitle === previous) return
    if (board) setBoard({ ...board, title: newTitle })
    // Goes through the API client so VITE_API_URL, auth and board-password headers apply.
    const res = await api.updateBoard(boardId, { title: newTitle })
    if (res.success) {
      toast.success('Board renamed')
    } else {
      setTitleValue(previous)
      const current = useBoardStore.getState().board
      if (current) setBoard({ ...current, title: previous })
      toast.error(res.error || 'Could not rename board')
    }
  }

  const saveUsername = () => {
    const oldName = socketService.username
    const newName = usernameValue.trim() || oldName
    setUsernameValue(newName)
    setEditingUsername(false)
    socketService.username = newName

    // Emit activity event for username change
    if (newName !== oldName) {
      const event = {
        id: generateId(),
        message: `${oldName} changed name to ${newName}`,
        username: newName,
        color: socketService.color,
        timestamp: new Date().toISOString(),
        type: 'rename' as const,
      }
      addActivityEvent(event)
      socketService.emitActivityEvent(boardId, event)
      // Update session on server so active users list shows new name
      socketService.emitUpdateUsername(boardId, newName)
      toast.success(`Username changed to ${newName}`)
    }
  }

  const toggleSaveBoard = async () => {
    const next = !board?.persistent
    const res = await api.updateBoard(boardId, { persistent: next })
    if (res.success && res.data?.board) {
      setBoard(res.data.board)
      toast.success(next ? 'Board saved — it will stay after everyone leaves' : 'Board is ephemeral again')
    } else {
      toast.error('Could not update board')
    }
  }

  const saveSecurity = async () => {
    if (!canManageSecurity) {
      toast.error('Sign in to manage board security')
      return
    }
    setSavingSecurity(true)
    const payload: { requireAuth: boolean; isLocked: boolean; password?: string; clearPassword?: boolean } = {
      requireAuth,
      isLocked,
    }
    if (newPassword.trim()) payload.password = newPassword.trim()
    const res = await api.updateBoard(boardId, payload)
    setSavingSecurity(false)
    if (res.success && res.data?.board) {
      setBoard(res.data.board)
      setNewPassword('')
      toast.success('Security settings saved')
    } else {
      toast.error(res.error || 'Could not update security settings')
    }
  }

  const toggleLockBoard = async () => {
    if (!canManageSecurity) {
      toast.error('Sign in to lock the board')
      return
    }
    const next = !isLocked
    setIsLocked(next)
    setSavingSecurity(true)
    const res = await api.updateBoard(boardId, { isLocked: next })
    setSavingSecurity(false)
    if (res.success && res.data?.board) {
      setBoard(res.data.board)
      toast.success(next ? 'Board locked — no new joins' : 'Board unlocked')
    } else {
      setIsLocked(!next)
      toast.error('Could not update lock status')
    }
  }

  const clearBoardPassword = async () => {
    setSavingSecurity(true)
    const res = await api.updateBoard(boardId, { clearPassword: true })
    setSavingSecurity(false)
    if (res.success && res.data?.board) {
      setBoard(res.data.board)
      toast.success('Board password removed')
    } else {
      toast.error('Could not remove password')
    }
  }

  const kickUser = (sessionId: string, username: string) => {
    socketService.emitKickUser(boardId, sessionId)
    setMenuUserId(null)
    toast.success(`Removed ${username}`)
  }

  const muteUser = (sessionId: string, username: string) => {
    socketService.emitMuteUser(boardId, sessionId)
    setMenuUserId(null)
    toast.success(`Muted ${username}`)
  }

  const formatRec = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  const navbarUsers = (() => {
    const kept: typeof activeUsers = []
    for (const user of activeUsers) {
      // You already appear as the name button on the right; only show the other people here.
      if (user.sessionId === socketService.sessionId) continue
      const name = user.username.toLowerCase().trim()
      const isDupe = kept.some((k) => {
        if (user.userId && k.userId && user.userId === k.userId) return true
        if (name && k.username.toLowerCase().trim() === name) return true
        return false
      })
      if (!isDupe) kept.push(user)
    }
    return kept
  })()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      height: 56, flexShrink: 0, position: 'relative', zIndex: 50,
      borderBottom: '1px solid var(--color-border)',
      background: 'var(--color-card)',
      padding: '0 16px',
    }}>
      {/* ── Left: Logo + Board Name ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 auto' }}>
        <button onClick={() => navigate('/')} title="Back to home" aria-label="Back to home"
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-foreground)', padding: 0, flexShrink: 0 }}>
          <LogoMark size={28} />
        </button>

        <div style={{ width: 1, height: 20, background: 'var(--color-border)' }} />

        {editingTitle ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input ref={titleInputRef} value={titleValue}
              onChange={e => setTitleValue(e.target.value)} onBlur={saveTitle}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setEditingTitle(false); setTitleValue(boardTitle) } }}
              style={{ height: 30, width: 180, borderRadius: 8, border: '1px solid var(--color-accent)', background: 'var(--color-surface-1)', padding: '0 10px', fontSize: 13, fontWeight: 500, color: 'var(--color-foreground)', outline: 'none' }}
            />
            <button onClick={saveTitle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', padding: 0, display: 'flex' }}>
              <Check style={{ width: 16, height: 16 }} />
            </button>
          </div>
        ) : (
          <button onClick={() => setEditingTitle(true)}
            title="Rename board"
            style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: 260, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--color-foreground)', padding: '6px 8px', borderRadius: 8, transition: 'background 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-muted)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleValue}</span>
            <Pencil style={{ width: 12, height: 12, opacity: 0.4, flexShrink: 0 }} />
          </button>
        )}
      </div>

      {/* ── Center: Active Users ── */}
      <div className="board-nav-avatars" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {navbarUsers.slice(0, 8).map((u, i) => (
          <div key={u.sessionId} style={{ position: 'relative', marginLeft: i > 0 ? -6 : 0, zIndex: navbarUsers.length - i }}>
            <button
              type="button"
              title={u.username}
              onClick={() => {
                if (canManageSecurity && u.sessionId !== socketService.sessionId) {
                  setMenuUserId(menuUserId === u.sessionId ? null : u.sessionId)
                }
              }}
              style={{
                width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: 'white', backgroundColor: u.color,
                border: '2px solid var(--color-card)', cursor: canManageSecurity && u.sessionId !== socketService.sessionId ? 'pointer' : 'default',
                boxShadow: '0 1px 3px rgba(0,0,0,0.15)', padding: 0,
              }}
            >
              {u.username.slice(0, 2).toUpperCase()}
            </button>
            {menuUserId === u.sessionId && (
              <div style={{
                position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)',
                background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 10,
                padding: 6, minWidth: 120, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 100,
              }}>
                <button type="button" onClick={() => muteUser(u.sessionId, u.username)}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '8px 10px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, borderRadius: 6, color: 'var(--color-foreground)' }}>
                  <MicOff style={{ width: 14, height: 14 }} /> Mute
                </button>
                <button type="button" onClick={() => kickUser(u.sessionId, u.username)}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '8px 10px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, borderRadius: 6, color: '#EF4444' }}>
                  <UserX style={{ width: 14, height: 14 }} /> Remove
                </button>
              </div>
            )}
          </div>
        ))}
        {navbarUsers.length > 8 && (
          <div style={{ height: 30, borderRadius: 999, background: 'var(--color-muted)', padding: '0 10px', fontSize: 10, fontWeight: 600, color: 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center', marginLeft: -6 }}>
            +{navbarUsers.length - 8}
          </div>
        )}
      </div>

      {/* ── Right: Username + Share + Theme + Sidebar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {/* Editable username */}
        {editingUsername ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input ref={usernameInputRef} value={usernameValue} maxLength={20}
              onChange={e => setUsernameValue(e.target.value)} onBlur={saveUsername}
              onKeyDown={e => { if (e.key === 'Enter') saveUsername(); if (e.key === 'Escape') { setEditingUsername(false); setUsernameValue(socketService.username) } }}
              style={{ height: 32, width: 120, borderRadius: 8, border: '1px solid var(--color-accent)', background: 'var(--color-surface-1)', padding: '0 10px', fontSize: 12, fontWeight: 500, color: 'var(--color-foreground)', outline: 'none' }}
            />
            <button onClick={saveUsername} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', padding: 0, display: 'flex' }}>
              <Check style={{ width: 14, height: 14 }} />
            </button>
            <button onClick={() => { setEditingUsername(false); setUsernameValue(socketService.username) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground)', padding: 0, display: 'flex' }}>
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        ) : (
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => setEditingUsername(true)} title="Click to change username"
            style={{
              display: 'flex', height: 34, alignItems: 'center', gap: 8,
              borderRadius: 999, border: '1px solid var(--color-border)', padding: '0 12px 0 6px',
              background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
              color: 'var(--color-muted-foreground)', transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.color = 'var(--color-foreground)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-muted-foreground)' }}
          >
            <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: 'white', backgroundColor: socketService.color }}>
              {usernameValue.slice(0, 2).toUpperCase()}
            </div>
            <span className="board-nav-label">{usernameValue}</span>
          </motion.button>
        )}

        {/* Presentation */}
        {onTogglePresentation && (
          <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={onTogglePresentation}
            title="Presentation mode"
            style={{
              display: 'flex', height: 34, alignItems: 'center', gap: 6,
              borderRadius: 999, padding: '0 12px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
              background: presentationOpen ? 'var(--color-accent-soft)' : 'var(--color-muted)',
              color: presentationOpen ? 'var(--color-accent)' : 'var(--color-muted-foreground)',
            }}
          >
            <Presentation style={{ width: 14, height: 14 }} />
            <span className="board-nav-label">Present</span>
          </motion.button>
        )}

        {/* Board security — always visible */}
        <div ref={securityRef} style={{ position: 'relative' }}>
          <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={toggleSecurityMenu}
            title="Board security"
            style={{
              display: 'flex', height: 34, alignItems: 'center', gap: 6,
              borderRadius: 999, padding: '0 12px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
              background: showSecurity || board?.isLocked ? 'var(--color-accent-soft)' : 'var(--color-muted)',
              color: board?.isLocked ? 'var(--color-accent)' : 'var(--color-muted-foreground)',
            }}
          >
            <Lock style={{ width: 14, height: 14 }} />
            <span className="board-nav-label">Security</span>
            <ChevronDown style={{ width: 14, height: 14, transition: 'transform 0.2s', transform: showSecurity ? 'rotate(180deg)' : 'none' }} />
            {board?.isLocked && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>
                LOCKED
              </span>
            )}
          </motion.button>
          {showSecurity && createPortal(
            <div
              data-security-menu
              style={{
                position: 'fixed', top: securityMenuPos.top, left: securityMenuPos.left, zIndex: 99999, width: 300,
                borderRadius: 12, border: '1px solid var(--color-border)', background: 'var(--color-card)',
                padding: 16, boxShadow: 'var(--shadow-xl)',
              }}
            >
              <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 14 }}>Board security</p>

              {!isSignedIn && (
                <div style={{ textAlign: 'center', padding: '8px 0 12px' }}>
                  <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', marginBottom: 12, lineHeight: 1.5 }}>
                    Sign in to lock the board, set a password, or manage access.
                  </p>
                  <button
                    type="button"
                    onClick={() => { void signInWithGoogle().catch(() => toast.error('Sign in failed')) }}
                    style={{ borderRadius: 10, border: 'none', padding: '10px 16px', background: 'var(--color-ink)', color: 'var(--color-ink-foreground)', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%' }}
                  >
                    Sign in with Google
                  </button>
                </div>
              )}

              {isSignedIn && hasOtherHost && (
                <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', lineHeight: 1.5, padding: '4px 0' }}>
                  Only the board host can change security settings.
                </p>
              )}

              {canManageSecurity && (
                <>
                  {!board?.ownerUid && (
                    <p style={{ fontSize: 11, color: 'var(--color-accent)', marginBottom: 12, lineHeight: 1.4, padding: '8px 10px', borderRadius: 8, background: 'var(--color-muted)' }}>
                      No host yet — saving will make you the board host.
                    </p>
                  )}

                  {/* Lock board */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--color-surface-1)' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>Lock board</div>
                      <div style={{ fontSize: 10, color: 'var(--color-muted-foreground)', marginTop: 2 }}>Block new participants</div>
                    </div>
                    <button
                      type="button"
                      disabled={savingSecurity}
                      onClick={() => { void toggleLockBoard() }}
                      style={{
                        width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                        background: isLocked ? 'var(--color-accent)' : 'var(--color-border-strong)',
                        position: 'relative', transition: 'background 0.2s',
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 3, left: isLocked ? 23 : 3, width: 18, height: 18,
                        borderRadius: '50%', background: 'white', transition: 'left 0.2s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }} />
                    </button>
                  </div>

                  <div style={{ height: 1, background: 'var(--color-border)', margin: '14px 0' }} />

                  {/* Password */}
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted-foreground)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Password protection
                  </p>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={board?.hasPassword ? 'New password (optional)' : 'Set board password'}
                    style={{ width: '100%', marginBottom: 10, borderRadius: 8, border: '1px solid var(--color-border)', padding: '8px 10px', fontSize: 12, background: 'var(--color-surface-1)', color: 'var(--color-foreground)' }}
                  />
                  {board?.hasPassword && (
                    <p style={{ fontSize: 10, color: 'var(--color-muted-foreground)', marginBottom: 10 }}>
                      Password is active. Enter a new one to change it.
                    </p>
                  )}

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 14, cursor: 'pointer' }}>
                    <input type="checkbox" checked={requireAuth} onChange={(e) => setRequireAuth(e.target.checked)} />
                    Require sign-in to join
                  </label>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" disabled={savingSecurity} onClick={() => { void saveSecurity() }}
                      style={{ flex: 1, borderRadius: 8, border: 'none', padding: '8px 0', background: 'var(--color-ink)', color: 'var(--color-ink-foreground)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Save
                    </button>
                    {board?.hasPassword && (
                      <button type="button" disabled={savingSecurity} onClick={() => { void clearBoardPassword() }}
                        style={{ borderRadius: 8, border: '1px solid var(--color-border)', padding: '8px 10px', background: 'transparent', fontSize: 12, cursor: 'pointer', color: 'var(--color-muted-foreground)' }}>
                        Remove pwd
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>,
            document.body,
          )}
        </div>

        {canManageSecurity && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 6,
            background: 'var(--color-accent-soft)', color: 'var(--color-accent)',
          }}>
            Host
          </span>
        )}

        {/* Save board */}
        <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={toggleSaveBoard}
          title={board?.persistent ? 'Board is saved' : 'Save board permanently'}
          style={{
            display: 'flex', height: 34, alignItems: 'center', gap: 6,
            borderRadius: 999, padding: '0 12px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            background: board?.persistent ? 'color-mix(in srgb, var(--color-success) 14%, transparent)' : 'var(--color-muted)',
            color: board?.persistent ? 'var(--color-success)' : 'var(--color-muted-foreground)',
          }}
        >
          <Bookmark style={{ width: 14, height: 14, fill: board?.persistent ? 'currentColor' : 'none' }} />
          <span className="board-nav-label">{board?.persistent ? 'Saved' : 'Save'}</span>
        </motion.button>

        {/* Record */}
        <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={toggleRecording}
          title={recording ? 'Stop recording' : 'Record canvas'}
          style={{
            display: 'flex', height: 34, alignItems: 'center', gap: 6,
            borderRadius: 999, padding: '0 12px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            background: recording ? 'rgba(239,68,68,0.15)' : 'var(--color-muted)',
            color: recording ? '#EF4444' : 'var(--color-muted-foreground)',
          }}
        >
          <Circle style={{ width: 10, height: 10, fill: recording ? '#EF4444' : 'none', color: recording ? '#EF4444' : 'currentColor' }} />
          {recording ? formatRec(elapsed) : <span className="board-nav-label">Rec</span>}
        </motion.button>

        {/* View-only badge */}
        {myRole === 'viewer' && (
          <span title="You can view, chat and join the call. Ask the host for edit access."
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 999, background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
            <Eye style={{ width: 13, height: 13 }} /> View only
          </span>
        )}

        {/* Share */}
        <motion.button ref={shareRef} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={() => setShowShare((open) => !open)}
          aria-expanded={showShare} aria-haspopup="dialog"
          style={{
            display: 'flex', height: 34, alignItems: 'center', gap: 6,
            borderRadius: 999, background: 'var(--color-ink)', padding: '0 16px',
            border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            color: 'var(--color-ink-foreground)',
          }}
        >
          <Share2 style={{ width: 14, height: 14 }} />
          Share
        </motion.button>
        {showShare && <SharePopover boardId={boardId} anchor={shareRef.current} onClose={() => setShowShare(false)} />}

        <ThemeToggle />

        {/* Sidebar toggle */}
        <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }} onClick={onToggleRightSidebar}
          style={{
            display: 'flex', width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
            borderRadius: 999, border: '1px solid var(--color-border)', background: 'none',
            cursor: 'pointer', color: 'var(--color-muted-foreground)', transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong)'; e.currentTarget.style.color = 'var(--color-foreground)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-muted-foreground)' }}
        >
          {rightSidebarOpen ? <PanelRightClose style={{ width: 16, height: 16 }} /> : <PanelRightOpen style={{ width: 16, height: 16 }} />}
        </motion.button>
      </div>
    </div>
  )
}
