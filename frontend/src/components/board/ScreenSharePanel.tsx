import { useRef, useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Maximize, Minimize, Columns2, Square, PictureInPicture2, ScanSearch, Shrink, X, MonitorUp, Eye, EyeOff, Expand,
} from 'lucide-react'
import { useBoardStore } from '@/stores/boardStore'

export type ShareLayout = 'focus' | 'split' | 'mini'

interface ViewerProps {
  stream: MediaStream | null
  username?: string
  connecting?: boolean
  layout: ShareLayout
  onLayoutChange: (layout: ShareLayout) => void
}

function HeaderButton({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={active} onClick={onClick}
      className={`toolbar-btn${active ? ' active' : ''}`} style={{ width: 32, height: 32, borderRadius: 9 }}>
      {children}
    </button>
  )
}

/** Attaches a stream to a <video>, keeping the element alive across layout changes. */
function useVideoStream(stream: MediaStream | null) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    if (stream) void el.play().catch(() => {})
  }, [stream])
  return ref
}

/**
 * What viewers see when someone shares: a large, readable view of the presenter's screen.
 * Focus fills the workspace, Side by side splits it with the board, Mini floats a preview.
 */
export function ScreenShareViewer({ stream, username, connecting, layout, onLayoutChange }: ViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useVideoStream(stream)
  const panelWidth = useBoardStore(s => s.screenSharePanelWidth)
  const setPanelWidth = useBoardStore(s => s.setScreenSharePanelWidth)
  const [actualSize, setActualSize] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [resolution, setResolution] = useState<{ w: number; h: number } | null>(null)
  const canPip = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // The side-by-side panel opens at roughly half the workspace so text is readable straight away.
  useEffect(() => {
    if (layout !== 'split') return
    const parent = rootRef.current?.parentElement
    if (parent && panelWidth < 420) setPanelWidth(Math.round(Math.min(900, Math.max(420, parent.clientWidth * 0.5))))
  }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void rootRef.current?.requestFullscreen?.().catch(() => {})
  }, [])

  const popOut = () => {
    const el = videoRef.current
    if (el && canPip) void el.requestPictureInPicture().then(() => onLayoutChange('mini')).catch(() => {})
  }

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidth
    const max = Math.max(420, (rootRef.current?.parentElement?.clientWidth ?? 1200) - 320)
    const onMove = (ev: PointerEvent) => setPanelWidth(Math.min(max, Math.max(320, startW + (startX - ev.clientX))))
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const presenter = username || 'Presenter'
  const mini = layout === 'mini' && !fullscreen

  const rootStyle: React.CSSProperties = fullscreen
    ? { position: 'relative', width: '100%', height: '100%', background: '#0B0B0A' }
    : layout === 'focus'
      ? { position: 'absolute', inset: 0, zIndex: 34, background: 'var(--color-background)', padding: '12px 12px 84px' }
      : layout === 'split'
        ? { position: 'relative', width: panelWidth, flexShrink: 0, borderLeft: '1px solid var(--color-border)', background: 'var(--color-background)', padding: 12 }
        : { position: 'absolute', right: 16, bottom: 76, zIndex: 36, width: 'min(320px, 40%)' }

  return (
    <div ref={rootRef} style={{ ...rootStyle, display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={`${presenter}'s screen`}>
      {layout === 'split' && !fullscreen && (
        <div onPointerDown={onResizeStart} title="Drag to resize"
          style={{ position: 'absolute', left: -4, top: 0, bottom: 0, width: 8, cursor: 'col-resize', zIndex: 2 }} />
      )}

      {/* Header */}
      {!mini && (
        <header className={fullscreen ? '' : 'floating-toolbar'}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 12px', flexShrink: 0, ...(fullscreen ? { position: 'absolute', top: 12, left: 12, right: 12, zIndex: 2, borderRadius: 14, background: 'rgba(20,20,19,0.75)', color: '#fff', backdropFilter: 'blur(10px)' } : {}) }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 99, background: 'color-mix(in srgb, var(--color-destructive) 14%, transparent)', color: 'var(--color-destructive)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>
            <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.6, repeat: Infinity }} style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />
            LIVE
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{presenter} is presenting</span>
          {resolution && <span className="hidden sm:inline" style={{ fontSize: 11, opacity: 0.6, fontFamily: 'var(--font-mono)' }}>{resolution.w}×{resolution.h}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
            <HeaderButton title={actualSize ? 'Fit to view' : 'Actual size (sharpest text)'} active={actualSize} onClick={() => setActualSize(v => !v)}>
              {actualSize ? <Shrink style={{ width: 15, height: 15 }} /> : <ScanSearch style={{ width: 15, height: 15 }} />}
            </HeaderButton>
            {!fullscreen && (
              <>
                <span style={{ width: 1, height: 18, background: 'var(--color-border)', margin: '0 4px' }} />
                <HeaderButton title="Focus: screen fills the workspace" active={layout === 'focus'} onClick={() => onLayoutChange('focus')}><Square style={{ width: 15, height: 15 }} /></HeaderButton>
                <HeaderButton title="Side by side with the board" active={layout === 'split'} onClick={() => onLayoutChange('split')}><Columns2 style={{ width: 15, height: 15 }} /></HeaderButton>
                <HeaderButton title="Minimize to a mini preview" onClick={() => onLayoutChange('mini')}><Minimize style={{ width: 15, height: 15 }} /></HeaderButton>
                {canPip && <HeaderButton title="Pop out (picture-in-picture)" onClick={popOut}><PictureInPicture2 style={{ width: 15, height: 15 }} /></HeaderButton>}
              </>
            )}
            <HeaderButton title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} onClick={toggleFullscreen}>
              {fullscreen ? <X style={{ width: 15, height: 15 }} /> : <Maximize style={{ width: 15, height: 15 }} />}
            </HeaderButton>
          </span>
        </header>
      )}

      {/* Screen */}
      <div
        onDoubleClick={toggleFullscreen}
        style={{
          position: 'relative', borderRadius: fullscreen ? 0 : mini ? 14 : 16, overflow: actualSize ? 'auto' : 'hidden',
          background: '#0B0B0A', display: 'flex', alignItems: actualSize ? 'flex-start' : 'center', justifyContent: actualSize ? 'flex-start' : 'center',
          boxShadow: mini ? 'var(--shadow-xl)' : 'none', border: mini ? '1px solid var(--color-border)' : 'none',
          // In a narrow side panel, hug the screen's own shape instead of a tall black box.
          ...(layout === 'split' && !actualSize && !fullscreen && resolution
            ? { flex: '0 1 auto', width: '100%', maxHeight: '100%', aspectRatio: `${resolution.w} / ${resolution.h}` }
            : { flex: 1, minHeight: 0, aspectRatio: mini ? '16 / 10' : undefined }),
          cursor: actualSize ? 'grab' : 'zoom-in',
        }}
      >
        {stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            onLoadedMetadata={e => setResolution({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            onResize={e => setResolution({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            style={actualSize
              ? { width: resolution?.w, height: resolution?.h, maxWidth: 'none', flexShrink: 0 }
              : { width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {connecting ? `Connecting to ${presenter}'s screen…` : 'Waiting for the screen…'}
          </div>
        )}

        {mini && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 8, background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent 35%, transparent 65%, rgba(0,0,0,0.55))' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{presenter}'s screen</span>
            <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => onLayoutChange('focus')} className="btn btn-sm" style={{ height: 30, background: '#fff', color: '#18181B' }}>
                <Expand style={{ width: 13, height: 13 }} /> Expand
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

interface PresenterProps {
  stream: MediaStream | null
  onStop: () => void
}

/**
 * What the presenter sees: a calm status pill instead of a mirror of their own screen
 * (sharing the board inside itself creates an endless tunnel). Preview is optional.
 */
export function PresenterBar({ stream, onStop }: PresenterProps) {
  const [preview, setPreview] = useState(false)
  const videoRef = useVideoStream(preview ? stream : null)
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -10, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }}
        className="floating-toolbar"
        style={{ position: 'absolute', top: 16, left: '50%', zIndex: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 12px', whiteSpace: 'nowrap' }}
        role="status"
      >
        <MonitorUp style={{ width: 15, height: 15, color: 'var(--color-accent)' }} />
        <span style={{ fontSize: 13, fontWeight: 500 }}>You're presenting</span>
        <button type="button" onClick={() => setPreview(v => !v)} className="btn btn-ghost btn-sm" style={{ height: 30, borderRadius: 9 }}>
          {preview ? <EyeOff style={{ width: 13, height: 13 }} /> : <Eye style={{ width: 13, height: 13 }} />}
          <span className="hidden sm:inline">{preview ? 'Hide preview' : 'Preview'}</span>
        </button>
        <button type="button" onClick={onStop} className="btn btn-sm" style={{ height: 30, borderRadius: 9, background: 'var(--color-destructive)', color: '#fff' }}>
          Stop sharing
        </button>
      </motion.div>
      <AnimatePresence>
        {preview && stream && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            style={{ position: 'absolute', right: 16, bottom: 76, zIndex: 36, width: 'min(280px, 40%)', aspectRatio: '16 / 10', borderRadius: 14, overflow: 'hidden', background: '#0B0B0A', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            <span style={{ position: 'absolute', left: 8, top: 8, fontSize: 11, fontWeight: 500, color: '#fff', padding: '2px 8px', borderRadius: 99, background: 'rgba(0,0,0,0.55)' }}>What others see</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
