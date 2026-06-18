import { useEffect, useCallback, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useBoardStore } from '@/stores/boardStore'
import { socketService } from '@/services/socket'
import { api } from '@/services/api'
import { toast } from 'sonner'
import ToolSidebar from '@/components/board/ToolSidebar'
import CanvasArea from '@/components/board/CanvasArea'
import RightSidebar from '@/components/board/RightSidebar'
import BoardNavbar from '@/components/board/BoardNavbar'
import BoardAccessGate from '@/components/board/BoardAccessGate'
import PresentationMode from '@/components/board/PresentationMode'
import MediaControlBar from '@/components/board/MediaControlBar'
import ParticipantVideos from '@/components/board/ParticipantVideos'
import ScreenSharePanel from '@/components/board/ScreenSharePanel'
import { useWebRTC } from '@/hooks/useWebRTC'
import { unlockNotificationAudio, playNotificationSound } from '@/lib/notificationSound'
import type { ToolType } from '@/types'

type PageState = 'loading' | 'ready' | 'locked' | 'not-found' | 'load-error'

export default function BoardPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { setBoard, setElements, setError, error, board } = useBoardStore()
  const [pageState, setPageState] = useState<PageState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)
  const [presentationOpen, setPresentationOpen] = useState(false)
  const [accessLocked, setAccessLocked] = useState(false)
  const [lockReason, setLockReason] = useState<'auth' | 'password' | 'locked'>('password')
  const [lockedBoardTitle, setLockedBoardTitle] = useState<string>()
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const prevScreenSharerIdRef = useRef<string | null>(null)

  const {
    audioEnabled,
    videoEnabled,
    toggleAudio,
    toggleVideo,
    toggleShare,
    stopSharing,
    leaveCall,
    isLocalSharing,
    isViewing,
    screenSharer,
    localScreenStream,
    remoteScreenStream,
  } = useWebRTC(id || '')

  const storeScreenSharer = useBoardStore((s) => s.screenSharer)

  const screenStream = isLocalSharing ? localScreenStream : remoteScreenStream
  const showScreenPanel = Boolean(
    (isLocalSharing && localScreenStream)
    || (!isLocalSharing && (remoteScreenStream || isViewing)),
  )

  useEffect(() => {
    const unlock = () => unlockNotificationAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    const mySessionId = socketService.sessionId
    const prevId = prevScreenSharerIdRef.current
    const nextId = storeScreenSharer?.sessionId ?? null

    if (nextId && nextId !== prevId && nextId !== mySessionId) {
      playNotificationSound('screenShare')
    } else if (!nextId && prevId && prevId !== mySessionId) {
      playNotificationSound('screenShareStop')
    }

    prevScreenSharerIdRef.current = nextId
  }, [storeScreenSharer])

  const fetchBoard = useCallback(async (boardId: string, password?: string): Promise<PageState> => {
    const storedPwd = password || sessionStorage.getItem(`aerix_board_pwd_${boardId}`) || undefined
    const res = await api.getBoard(boardId, {
      boardPassword: storedPwd,
      sessionId: socketService.sessionId,
    })

    if (!res.success || !res.data) {
      const msg = res.error || ''
      if (/not found|expired/i.test(msg)) return 'not-found'
      setLoadError(msg || 'Could not load board')
      return 'load-error'
    }

    if (res.data.locked) {
      setLockedBoardTitle(res.data.board.title)
      setLockReason(res.data.reason || 'password')
      return 'locked'
    }

    setBoard(res.data.board)
    setElements(res.data.elements)
    setError(null)
    api.recordBoardVisit(boardId, res.data.board.title).catch(() => {})
    socketService.joinBoard(boardId, storedPwd)
    return 'ready'
  }, [setBoard, setElements, setError])

  useEffect(() => {
    if (!id) return

    let cancelled = false
    setPageState('loading')
    setLoadError(null)
    setAccessLocked(false)

    const safetyTimer = window.setTimeout(() => {
      if (!cancelled) {
        setLoadError('This is taking too long. The server may be waking up.')
        setPageState('load-error')
      }
    }, 20000)

    const run = async () => {
      let state = await fetchBoard(id)
      if (cancelled) return

      if (state === 'load-error') {
        await new Promise((r) => setTimeout(r, 600))
        if (cancelled) return
        const retry = await fetchBoard(id)
        if (!cancelled) state = retry
      }

      if (cancelled) return
      clearTimeout(safetyTimer)

      if (state === 'load-error') {
        setPageState('load-error')
      } else if (state === 'not-found') {
        setPageState('not-found')
      } else if (state === 'locked') {
        setAccessLocked(true)
        setPageState('locked')
      } else {
        setPageState(state)
      }
    }

    void run()

    return () => {
      cancelled = true
      clearTimeout(safetyTimer)
      socketService.leaveBoard(id)
    }
  }, [id, fetchBoard])

  const handleAccessUnlocked = useCallback(async (password?: string) => {
    if (!id) return
    setPageState('loading')
    const state = await fetchBoard(id, password)
    if (state === 'locked') {
      setAccessLocked(true)
      setPageState('locked')
    } else if (state === 'ready') {
      setAccessLocked(false)
      setPageState('ready')
    } else {
      setLoadError('Still unable to access this board')
      setPageState('load-error')
      toast.error('Still unable to access this board')
    }
  }, [id, fetchBoard])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

    const store = useBoardStore.getState()

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (store.selectedElementIds.length > 0) {
        store.selectedElementIds.forEach((eid) => {
          store.deleteElement(eid)
          if (id) socketService.emitDeleteElement(id, eid)
        })
      }
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          store.redo()
        } else {
          store.undo()
        }
        if (id) syncFullState(id)
      }
      if (e.key === 'y') {
        e.preventDefault()
        store.redo()
        if (id) syncFullState(id)
      }
      if (e.key === 'v') { e.preventDefault(); store.duplicateSelected() }
      if (e.key === 'a') { e.preventDefault(); store.selectAll() }
    }

    if (e.key === 'Escape') store.clearSelection()

    const toolMap: Record<string, ToolType> = {
      v: 'select', p: 'pen', r: 'rectangle', c: 'circle',
      l: 'line', a: 'arrow', t: 'text', s: 'sticky', e: 'eraser', f: 'frame',
    }
    if (!e.ctrlKey && !e.metaKey && toolMap[e.key]) {
      store.setActiveTool(toolMap[e.key])
    }
  }, [id])

  const syncFullState = useCallback((boardId: string) => {
    const elements = useBoardStore.getState().elements
    socketService.emitSyncState(boardId, elements)
  }, [])

  const handleLeaveBoard = useCallback(async () => {
    await leaveCall()
    if (id) {
      socketService.leaveBoard(id)
    }
    toast.success('Left board')
    navigate('/', { replace: true })
  }, [id, leaveCall, navigate])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (id) socketService.leaveBoard(id)
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [id])

  if (pageState === 'loading') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        background: '#F8FAFC',
      }}
      >
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          border: '3px solid #E2E8F0', borderTop: '3px solid #6366F1',
          animation: 'aerix-spin 0.8s linear infinite',
        }}
        />
        <p style={{ fontSize: 14, color: '#334155', fontWeight: 500 }}>Loading board…</p>
        <p style={{ fontSize: 12, color: '#64748B' }}>First load can take a few seconds if the server was asleep</p>
        <style>{'@keyframes aerix-spin { to { transform: rotate(360deg) } }'}</style>
      </div>
    )
  }

  if (pageState === 'load-error') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        padding: 24, background: '#F8FAFC', textAlign: 'center',
      }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A' }}>Could not load board</h1>
        <p style={{ fontSize: 14, color: '#64748B', maxWidth: 420 }}>{loadError || 'Please try again.'}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => { window.location.reload() }}
            style={{
              borderRadius: 10, border: 'none', padding: '10px 20px',
              background: '#6366F1', color: 'white', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            style={{
              borderRadius: 10, border: '1px solid #E2E8F0', padding: '10px 20px',
              background: 'white', color: '#334155', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Homepage
          </button>
        </div>
      </div>
    )
  }

  if (pageState === 'not-found') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        padding: 24, background: 'var(--color-background, #F8FAFC)', textAlign: 'center',
      }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A' }}>Board not found</h1>
        <p style={{ fontSize: 14, color: '#64748B', maxWidth: 400 }}>
          This board may have expired or the link is incorrect. Ephemeral boards are removed after everyone leaves.
        </p>
        <button
          type="button"
          onClick={() => navigate('/')}
          style={{
            borderRadius: 10, border: 'none', padding: '10px 20px',
            background: '#6366F1', color: 'white', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Go to homepage
        </button>
      </div>
    )
  }

  if ((pageState === 'locked' || accessLocked) && id) {
    return (
      <BoardAccessGate
        boardId={id}
        reason={lockReason}
        boardTitle={lockedBoardTitle}
        onUnlocked={(pwd) => { void handleAccessUnlocked(pwd) }}
      />
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}>
        <p style={{ color: '#EF4444' }}>{error}</p>
      </div>
    )
  }

  if (pageState !== 'ready') {
    return null
  }

  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', overflow: 'hidden', background: '#F8FAFC' }}>
      <BoardNavbar
        boardTitle={board?.title || 'Untitled Board'}
        boardId={id || ''}
        onToggleRightSidebar={() => setRightSidebarOpen(!rightSidebarOpen)}
        rightSidebarOpen={rightSidebarOpen}
        canvasContainerRef={canvasWrapRef}
        onTogglePresentation={() => setPresentationOpen((v) => !v)}
        presentationOpen={presentationOpen}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ToolSidebar />
        <div ref={canvasWrapRef} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <CanvasArea boardId={id || ''} />
          {showScreenPanel && (
            <ScreenSharePanel
              stream={screenStream}
              username={screenSharer?.username}
              isLocal={isLocalSharing}
              connecting={!isLocalSharing && isViewing && !remoteScreenStream}
              onClose={isLocalSharing ? stopSharing : undefined}
            />
          )}
        </div>
        <AnimatePresence>
          {rightSidebarOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="overflow-hidden shrink-0"
            >
              <RightSidebar boardId={id || ''} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <MediaControlBar
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        toggleAudio={toggleAudio}
        toggleVideo={toggleVideo}
        isLocalSharing={isLocalSharing}
        onToggleShare={toggleShare}
        onLeaveBoard={() => { void handleLeaveBoard() }}
      />
      <ParticipantVideos />
      {presentationOpen && <PresentationMode onClose={() => setPresentationOpen(false)} />}
    </div>
  )
}
