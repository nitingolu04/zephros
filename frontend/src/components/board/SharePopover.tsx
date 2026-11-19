import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Eye, Pencil, RefreshCw, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { useBoardStore } from '@/stores/boardStore'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/services/api'

interface Props {
  boardId: string
  anchor: HTMLElement | null
  onClose: () => void
}

const boardLink = (boardId: string) => `${window.location.origin}/board/${boardId}`

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
  } catch {
    toast.error('Could not copy. Select the link and copy it manually.')
  }
}

/**
 * Share menu: copy the board link, and (for the host) choose whether people with that link can edit
 * or only view, plus a separate editor link that always allows editing.
 */
export default function SharePopover({ boardId, anchor, onClose }: Props) {
  const board = useBoardStore((s) => s.board)
  const setBoard = useBoardStore((s) => s.setBoard)
  const myRole = useBoardStore((s) => s.myRole)
  const authUser = useAuthStore((s) => s.user)
  const isOwner = Boolean(board?.ownerUid && authUser?.uid && board.ownerUid === authUser.uid)
  const linkAccess = board?.linkAccess ?? 'edit'

  const [editToken, setEditToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const rect = anchor?.getBoundingClientRect()
  const pos = { top: (rect?.bottom ?? 56) + 6, left: Math.max(8, (rect?.right ?? 340) - 340) }

  useEffect(() => {
    if (!isOwner) return
    let cancelled = false
    void api.getShare(boardId).then((res) => {
      if (!cancelled && res.success && res.data) setEditToken(res.data.editLinkToken)
    })
    return () => { cancelled = true }
  }, [boardId, isOwner])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element
      if (anchor?.contains(target) || target.closest?.('[data-share-menu]')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const timer = window.setTimeout(() => document.addEventListener('pointerdown', onPointerDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])

  const setLinkAccess = async (next: 'edit' | 'view') => {
    if (!isOwner || next === linkAccess || busy) return
    setBusy(true)
    const res = await api.updateBoard(boardId, { linkAccess: next })
    setBusy(false)
    if (res.success && res.data?.board) {
      setBoard({ ...res.data.board, linkAccess: next })
      toast.success(next === 'view' ? 'People with the link can now only view' : 'People with the link can now edit')
    } else {
      toast.error(res.error || 'Could not change link access')
    }
  }

  const resetEditLink = async () => {
    setBusy(true)
    const res = await api.resetEditLink(boardId)
    setBusy(false)
    if (res.success && res.data) {
      setEditToken(res.data.editLinkToken)
      toast.success('New editor link created. The old one no longer gives edit access.')
    } else {
      toast.error(res.error || 'Could not reset the editor link')
    }
  }

  const segment = (value: 'edit' | 'view', label: string, Icon: typeof Eye) => {
    const active = linkAccess === value
    return (
      <button type="button" disabled={!isOwner || busy} onClick={() => { void setLinkAccess(value) }}
        aria-pressed={active}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 32, borderRadius: 8,
          border: 'none', fontSize: 12, fontWeight: 600, cursor: isOwner ? 'pointer' : 'default',
          background: active ? 'var(--color-card)' : 'transparent',
          color: active ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
          boxShadow: active ? 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.08))' : 'none',
        }}>
        <Icon style={{ width: 13, height: 13 }} /> {label}
      </button>
    )
  }

  const label = { fontSize: 11, fontWeight: 600, color: 'var(--color-muted-foreground)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 8 }
  const linkBox = { flex: 1, minWidth: 0, height: 34, borderRadius: 8, border: '1px solid var(--color-border)', padding: '0 10px', fontSize: 12, background: 'var(--color-surface-1)', color: 'var(--color-foreground)' }
  const iconBtn = { display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: 'var(--color-ink)', color: 'var(--color-ink-foreground)', flexShrink: 0 }

  return createPortal(
    <div data-share-menu role="dialog" aria-label="Share board"
      style={{
        position: 'fixed', top: pos.top, left: pos.left, zIndex: 99999, width: 340,
        borderRadius: 14, border: '1px solid var(--color-border)', background: 'var(--color-card)',
        padding: 16, boxShadow: 'var(--shadow-xl)', color: 'var(--color-foreground)',
      }}>
      <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Share board</p>
      <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', marginBottom: 14, lineHeight: 1.5 }}>
        {myRole === 'viewer' ? 'You can view this board. Ask the host if you need to edit.' : 'Send this link to invite people to the board and the call.'}
      </p>

      <p style={label}>Board link</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <input readOnly value={boardLink(boardId)} onFocus={(e) => e.currentTarget.select()} style={linkBox} aria-label="Board link" />
        <button type="button" style={iconBtn} onClick={() => { void copy(boardLink(boardId), 'Board link copied') }}>
          <Copy style={{ width: 13, height: 13 }} /> Copy
        </button>
      </div>

      <p style={label}>Anyone with the board link</p>
      <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 10, background: 'var(--color-muted)', marginBottom: 6 }}>
        {segment('edit', 'Can edit', Pencil)}
        {segment('view', 'Can view', Eye)}
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-muted-foreground)', lineHeight: 1.5, marginBottom: isOwner ? 16 : 0 }}>
        {isOwner
          ? linkAccess === 'view'
            ? 'Viewers can watch, chat, join the call and use the laser pointer, but cannot change the board.'
            : 'Everyone who opens the link can draw and edit.'
          : board?.ownerUid
            ? 'Only the host can change this.'
            : 'This board has no host. Sign in and create a board to control who can edit.'}
      </p>

      {isOwner && (
        <>
          <p style={label}>Editor link</p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input readOnly value={editToken ? `${boardLink(boardId)}?edit=${editToken}` : 'Creating…'} onFocus={(e) => e.currentTarget.select()} style={linkBox} aria-label="Editor link" />
            <button type="button" style={iconBtn} disabled={!editToken}
              onClick={() => { if (editToken) void copy(`${boardLink(boardId)}?edit=${editToken}`, 'Editor link copied') }}>
              <Link2 style={{ width: 13, height: 13 }} /> Copy
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <p style={{ fontSize: 11, color: 'var(--color-muted-foreground)', lineHeight: 1.5 }}>
              Always gives edit access, even when the board link is view-only. Share it only with co-teachers or presenters.
            </p>
            <button type="button" disabled={busy} onClick={() => { void resetEditLink() }} title="Create a new editor link; the old one stops giving edit access"
              style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--color-accent)', flexShrink: 0, padding: 0 }}>
              <RefreshCw style={{ width: 12, height: 12 }} /> Reset
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--color-muted-foreground)', lineHeight: 1.5, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
            To change one person during the meeting, open <strong>People</strong> in the sidebar and use the pencil / eye button next to their name.
          </p>
        </>
      )}
    </div>,
    document.body,
  )
}
