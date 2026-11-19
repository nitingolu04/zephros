import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { History, X, RotateCcw, Trash2, Save, HardDrive, Cloud } from 'lucide-react'
import { toast } from 'sonner'
import { diffElements } from '@/lib/canvasHistory.js'
import { useBoardStore } from '@/stores/boardStore'
import { socketService } from '@/services/socket'
import { api, isMissingEndpoint } from '@/services/api'
import * as local from '@/lib/versionHistory'
import { formatTimeAgo } from '@/lib/utils'

const AUTO_SAVE_MS = 2 * 60 * 1000

/**
 * Where versions live: on the server (shared by everyone, auto-saved by the backend) when the
 * backend has the versions API, otherwise in this browser (older backends).
 */
type Mode = 'server' | 'local'
const modeCache = new Map<string, Mode>()

async function detectMode(boardId: string): Promise<Mode | null> {
  const cached = modeCache.get(boardId)
  if (cached) return cached
  const res = await api.listVersions(boardId)
  const mode: Mode | null = res.success ? 'server' : isMissingEndpoint(res.error) ? 'local' : null
  if (mode) modeCache.set(boardId, mode)
  return mode
}

interface VersionItem {
  id: string
  label: string
  auto: boolean
  count: number
  createdAt: number
  author?: string
  elements?: local.BoardVersion['elements']
}

/** Browser-side auto-save, used only on backends without server version history. */
export function useAutoVersions(boardId: string | undefined) {
  const lastPrint = useRef<string | null>(null)
  useEffect(() => {
    if (!boardId) return
    lastPrint.current = null
    const timer = setInterval(() => {
      if (modeCache.get(boardId) !== 'local') return // the server auto-saves (or mode not known yet)
      const { elements, board } = useBoardStore.getState()
      if (board?.roomId !== boardId || elements.length === 0) return
      const print = local.fingerprint(elements)
      if (lastPrint.current === null) { lastPrint.current = print; return } // baseline on first tick
      if (print === lastPrint.current) return
      lastPrint.current = print
      local.saveVersion(boardId, elements, 'Auto-save', true).catch(() => { /* storage unavailable */ })
    }, AUTO_SAVE_MS)
    void detectMode(boardId)
    return () => clearInterval(timer)
  }, [boardId])
}

export default function VersionHistoryPanel({ boardId }: { boardId: string }) {
  const open = useBoardStore(s => s.showVersionHistory)
  const setOpen = useBoardStore(s => s.setShowVersionHistory)
  const [mode, setMode] = useState<Mode | null>(modeCache.get(boardId) ?? null)
  const [versions, setVersions] = useState<VersionItem[]>([])
  const [canManage, setCanManage] = useState(true)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const detected = await detectMode(boardId)
    setMode(detected)
    if (detected === 'server') {
      const res = await api.listVersions(boardId)
      if (!res.success || !res.data) { setLoadError(res.error || 'Could not load versions'); return }
      setLoadError(null)
      setCanManage(res.data.canManage)
      setVersions(res.data.versions.map(v => ({
        id: v.id, label: v.label, auto: v.auto, count: v.count,
        createdAt: new Date(v.createdAt).getTime(), author: v.createdBy?.username,
      })))
    } else if (detected === 'local') {
      setLoadError(null)
      setCanManage(true)
      setVersions(await local.listVersions(boardId).catch(() => []))
    } else {
      setLoadError('Could not reach the server')
    }
  }, [boardId])

  useEffect(() => { if (open) void refresh() }, [open, refresh])

  const handleSave = async () => {
    setBusy(true)
    try {
      if (mode === 'server') {
        const res = await api.createVersion(boardId, label, socketService.username)
        if (!res.success) throw new Error(res.error)
        toast.success('Version saved with the board')
      } else {
        await local.saveVersion(boardId, useBoardStore.getState().elements, label)
        toast.success('Version saved on this device')
      }
      setLabel('')
      await refresh()
    } catch (err) {
      toast.error((err as Error).message || 'Could not save version')
    } finally {
      setBusy(false)
    }
  }

  const handleRestore = async (version: VersionItem) => {
    setBusy(true)
    try {
      if (mode === 'server') {
        // The server restores atomically for everyone and broadcasts the new board state.
        const res = await api.restoreVersion(boardId, version.id, socketService.username)
        if (!res.success) throw new Error(res.error)
        toast.success(`Restored "${version.label}"`, { description: 'Everyone sees it now. A "Before restoring" copy was saved, so you can go back.' })
      } else {
        if (!socketService.canEdit(boardId) || !version.elements) return
        const store = useBoardStore.getState()
        const current = store.elements
        const patches = diffElements(current, version.elements)
        if (!patches.length) { toast.info('The board already matches this version'); return }
        await local.saveVersion(boardId, current, `Before restoring "${version.label}"`, true)
        store.replaceElements(version.elements)
        socketService.emitPatches(boardId, patches)
        toast.success(`Restored "${version.label}"`, { description: 'Everyone on the board sees the restored version. Undo is available.' })
      }
      await refresh()
    } catch (err) {
      toast.error((err as Error).message || 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (version: VersionItem) => {
    if (mode === 'server') {
      const res = await api.deleteVersion(boardId, version.id)
      if (!res.success) toast.error(res.error || 'Could not delete version')
    } else {
      await local.deleteVersion(version.id).catch(() => {})
    }
    await refresh()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="panel"
          aria-label="Version history"
          style={{ position: 'absolute', left: 84, top: 16, bottom: 88, zIndex: 40, width: 'min(320px, calc(100% - 100px))', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 14px 12px', borderBottom: '1px solid var(--color-border)' }}>
            <History style={{ width: 16, height: 16 }} />
            <span className="panel-title" style={{ flex: 1 }}>Version history</span>
            <button type="button" onClick={() => setOpen(false)} className="toolbar-btn toolbar-btn-compact" aria-label="Close version history">
              <X style={{ width: 16, height: 16 }} />
            </button>
          </header>

          <form onSubmit={e => { e.preventDefault(); void handleSave() }} style={{ display: 'flex', gap: 8, padding: 14, borderBottom: '1px solid var(--color-border)' }}>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Name this version (optional)"
              maxLength={80}
              style={{ flex: 1, minWidth: 0, height: 36, borderRadius: 9, border: '1px solid var(--color-border)', background: 'var(--color-surface-1)', padding: '0 10px', fontSize: 13, color: 'var(--color-foreground)', outline: 'none' }}
            />
            <button type="submit" disabled={busy || !mode} className="btn btn-primary btn-sm" style={{ borderRadius: 9 }}>
              <Save style={{ width: 14, height: 14 }} /> Save
            </button>
          </form>

          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {loadError ? (
              <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: 14, fontWeight: 500 }}>Couldn't load versions</p>
                <p className="panel-subtle" style={{ marginTop: 6 }}>{loadError}</p>
                <button type="button" onClick={() => void refresh()} className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>Try again</button>
              </div>
            ) : versions.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: 14, fontWeight: 500 }}>No versions yet</p>
                <p className="panel-subtle" style={{ marginTop: 6, lineHeight: 1.5 }}>Save one now, or keep working — changes are auto-saved every 2 minutes.</p>
              </div>
            ) : versions.map((version, i) => (
              <motion.div
                key={version.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.03 }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderRadius: 10 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-muted)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ width: 8, height: 8, borderRadius: 99, flexShrink: 0, background: version.auto ? 'var(--color-border-strong)' : 'var(--color-accent)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{version.label}</div>
                  <div className="panel-subtle" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {formatTimeAgo(new Date(version.createdAt).toISOString())} · {version.count} item{version.count === 1 ? '' : 's'}{version.author ? ` · ${version.author}` : ''}
                  </div>
                </div>
                {canManage && (
                  <>
                    <button type="button" title="Restore this version" disabled={busy} onClick={() => void handleRestore(version)}
                      className="toolbar-btn toolbar-btn-compact" style={{ color: 'var(--color-accent)' }}>
                      <RotateCcw style={{ width: 15, height: 15 }} />
                    </button>
                    <button type="button" title="Delete version" onClick={() => void handleDelete(version)} className="toolbar-btn toolbar-btn-compact">
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  </>
                )}
              </motion.div>
            ))}
          </div>

          <footer className="panel-subtle" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderTop: '1px solid var(--color-border)' }}>
            {mode === 'server'
              ? <><Cloud style={{ width: 13, height: 13 }} /> Saved with the board{canManage ? '' : ' · only the owner can restore'}</>
              : <><HardDrive style={{ width: 13, height: 13 }} /> Stored in this browser only</>}
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
