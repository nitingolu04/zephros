import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MicOff, VideoOff, LayoutGrid, Minus, Maximize2, X, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { useMediaStore } from '@/stores/mediaStore'
import { socketService } from '@/services/socket'
import type { MediaParticipant } from '@/types'

type StageMode = 'dock' | 'grid' | 'min'
const MAX_DOCK_TILES = 3
const GRID_PAGE_SIZE = 9
const MODE_KEY = 'zephros-video-stage'

interface Tile extends MediaParticipant {
  stream: MediaStream | null
  local: boolean
}

/* ── Active-speaker detection: one shared AudioContext, cheap RMS sampling ── */
let sharedAudioContext: AudioContext | null = null
function audioContext() {
  if (!sharedAudioContext && typeof window !== 'undefined' && 'AudioContext' in window) sharedAudioContext = new AudioContext()
  return sharedAudioContext
}

function useSpeaking(stream: MediaStream | null, enabled: boolean) {
  const [speaking, setSpeaking] = useState(false)
  useEffect(() => {
    const track = stream?.getAudioTracks().find(t => t.readyState === 'live')
    const ctx = enabled && track ? audioContext() : null
    if (!ctx || !track) { setSpeaking(false); return }
    let source: MediaStreamAudioSourceNode | null = null
    let timer = 0
    try {
      source = ctx.createMediaStreamSource(new MediaStream([track]))
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      let quietFor = 0
      timer = window.setInterval(() => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (const v of data) sum += (v - 128) * (v - 128)
        const loud = Math.sqrt(sum / data.length) > 6
        quietFor = loud ? 0 : quietFor + 1
        setSpeaking(loud || quietFor < 3) // short hold so the ring doesn't flicker between words
      }, 150)
    } catch {
      setSpeaking(false)
    }
    return () => { window.clearInterval(timer); source?.disconnect() }
  }, [stream, enabled])
  return speaking
}

/** Plays remote audio for every participant, independent of which tiles are visible. */
function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => { /* autoplay blocked until the user interacts; retried on next stream change */ })
    return () => { el.srcObject = null }
  }, [stream])
  return <audio ref={ref} autoPlay playsInline style={{ display: 'none' }} />
}

function VideoTile({ tile, size = 'dock' }: { tile: Tile; size?: 'dock' | 'grid' }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasVideo = Boolean(tile.stream?.getVideoTracks().some(t => t.enabled && t.readyState === 'live'))
  const showVideo = tile.videoEnabled && hasVideo
  const speaking = useSpeaking(tile.stream, tile.audioEnabled)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.srcObject = showVideo ? tile.stream : null
    if (showVideo) void el.play().catch(() => {})
  }, [tile.stream, showVideo])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: 'relative', aspectRatio: '16 / 10', width: '100%', borderRadius: size === 'grid' ? 16 : 12,
        overflow: 'hidden', background: '#1B1B19',
        boxShadow: speaking ? '0 0 0 2px var(--color-card), 0 0 0 4px var(--color-success)' : '0 0 0 1px rgba(255,255,255,0.06)',
        transition: 'box-shadow 0.2s ease',
      }}
    >
      {/* Video elements are always muted: audio plays through <RemoteAudio>. */}
      {showVideo ? (
        <video ref={videoRef} autoPlay playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: tile.local ? 'scaleX(-1)' : undefined }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: `radial-gradient(circle at 50% 40%, color-mix(in srgb, ${tile.color} 45%, #1B1B19), #1B1B19 75%)` }}>
          <span style={{
            width: size === 'grid' ? 72 : 44, height: size === 'grid' ? 72 : 44, borderRadius: '50%', display: 'grid', placeItems: 'center',
            background: tile.color, color: '#fff', fontWeight: 600, fontSize: size === 'grid' ? 26 : 16,
            boxShadow: speaking ? '0 0 0 6px color-mix(in srgb, var(--color-success) 35%, transparent)' : 'none', transition: 'box-shadow 0.2s ease',
          }}>
            {tile.username.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <div style={{ position: 'absolute', left: 6, right: 6, bottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 99, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', color: '#fff', fontSize: 11, fontWeight: 500 }}>
          {!tile.audioEnabled && <MicOff style={{ width: 11, height: 11, color: '#FCA5A5', flexShrink: 0 }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tile.username}{tile.local ? ' (you)' : ''}</span>
        </span>
        {!tile.videoEnabled && size === 'grid' && <VideoOff style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.7)', marginLeft: 'auto' }} />}
      </div>
    </motion.div>
  )
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="toolbar-btn" style={{ width: 28, height: 28, borderRadius: 8 }}>
      {children}
    </button>
  )
}

export default function ParticipantVideos() {
  const participants = useMediaStore(s => s.participants)
  const remoteStreams = useMediaStore(s => s.remoteStreams)
  const localStream = useMediaStore(s => s.localStream)
  const sessionId = socketService.sessionId
  const [mode, setModeState] = useState<StageMode>(() => {
    try { return (localStorage.getItem(MODE_KEY) as StageMode) || 'dock' } catch { return 'dock' }
  })
  const [page, setPage] = useState(0)
  const setMode = (next: StageMode) => {
    setModeState(next)
    try { localStorage.setItem(MODE_KEY, next === 'grid' ? 'dock' : next) } catch { /* ignore */ }
  }

  // Cameras first, then mic-only people, yourself last — so the most useful faces are always visible.
  const tiles = useMemo<Tile[]>(() => {
    const list = participants.map(p => {
      const local = Boolean(p.isLocal || p.sessionId === sessionId)
      return { ...p, local, stream: local ? localStream : remoteStreams.get(p.sessionId) ?? null }
    })
    const rank = (t: Tile) => (t.local ? 2 : 0) + (t.videoEnabled ? 0 : 1)
    return list.sort((a, b) => rank(a) - rank(b))
  }, [participants, remoteStreams, localStream, sessionId])

  const remoteAudio = tiles.filter(t => !t.local && t.stream?.getAudioTracks().length)
  const visible = tiles.length > 0 && tiles.some(t => t.videoEnabled || t.audioEnabled || !t.local)
  const pages = Math.max(1, Math.ceil(tiles.length / GRID_PAGE_SIZE))
  useEffect(() => { if (page >= pages) setPage(pages - 1) }, [page, pages])

  if (!visible) return <>{remoteAudio.map(t => <RemoteAudio key={t.sessionId} stream={t.stream!} />)}</>

  const docked = tiles.slice(0, MAX_DOCK_TILES)
  const hidden = tiles.length - docked.length
  const gridTiles = tiles.slice(page * GRID_PAGE_SIZE, (page + 1) * GRID_PAGE_SIZE)
  const gridCols = gridTiles.length <= 1 ? 1 : gridTiles.length <= 4 ? 2 : 3
  const gridRows = Math.max(1, Math.ceil(gridTiles.length / gridCols))
  // Fit the whole page of 16:10 tiles in the available height as well as the width.
  const gridMaxWidth = `min(${gridCols === 1 ? 760 : 1100}px, calc((100vh - 280px) * ${(1.6 * gridCols / gridRows).toFixed(3)}))`

  return (
    <>
      {remoteAudio.map(t => <RemoteAudio key={t.sessionId} stream={t.stream!} />)}

      <AnimatePresence mode="wait" initial={false}>
        {mode === 'min' && (
          <motion.button key="min" type="button" onClick={() => setMode('dock')} title="Show video"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="floating-toolbar"
            style={{ position: 'absolute', top: 16, right: 16, zIndex: 35, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 6px', cursor: 'pointer', color: 'var(--color-foreground)', border: '1px solid var(--color-border)' }}>
            <span style={{ display: 'flex' }}>
              {tiles.slice(0, 4).map((t, i) => (
                <span key={t.sessionId} style={{ width: 26, height: 26, borderRadius: 99, background: t.color, color: '#fff', fontSize: 11, fontWeight: 600, display: 'grid', placeItems: 'center', border: '2px solid var(--color-card)', marginLeft: i ? -8 : 0 }}>
                  {t.username.charAt(0).toUpperCase()}
                </span>
              ))}
            </span>
            <span style={{ fontSize: 12, fontWeight: 500 }}>{tiles.length} in call</span>
            <Maximize2 style={{ width: 13, height: 13, color: 'var(--color-muted-foreground)' }} />
          </motion.button>
        )}

        {mode === 'dock' && (
          <motion.section key="dock" aria-label="Video call"
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="floating-toolbar"
            style={{ position: 'absolute', top: 16, right: 16, zIndex: 35, width: 'clamp(180px, 18vw, 232px)', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px 2px 6px' }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--color-success)' }} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>In call · {tiles.length}</span>
              <IconButton title="Grid view" onClick={() => setMode('grid')}><LayoutGrid style={{ width: 14, height: 14 }} /></IconButton>
              <IconButton title="Minimize" onClick={() => setMode('min')}><Minus style={{ width: 14, height: 14 }} /></IconButton>
            </header>
            <AnimatePresence initial={false}>
              {docked.map(t => <VideoTile key={t.sessionId} tile={t} />)}
            </AnimatePresence>
            {hidden > 0 && (
              <button type="button" onClick={() => setMode('grid')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 34, borderRadius: 10, border: '1px dashed var(--color-border-strong)', background: 'transparent', color: 'var(--color-foreground)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                <Users style={{ width: 13, height: 13 }} /> +{hidden} more · view all
              </button>
            )}
          </motion.section>
        )}

        {mode === 'grid' && (
          <motion.section key="grid" aria-label="Video call grid"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'absolute', inset: 0, zIndex: 45, background: 'color-mix(in srgb, var(--color-background) 72%, transparent)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', padding: 'clamp(12px, 3vw, 32px)', paddingBottom: 96 }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--color-success)' }} />
              <span style={{ fontSize: 15, fontWeight: 600 }}>In call · {tiles.length}</span>
              {pages > 1 && (
                <span style={{ marginLeft: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <IconButton title="Previous page" onClick={() => setPage(p => Math.max(0, p - 1))}><ChevronLeft style={{ width: 15, height: 15 }} /></IconButton>
                  <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>{page + 1} / {pages}</span>
                  <IconButton title="Next page" onClick={() => setPage(p => Math.min(pages - 1, p + 1))}><ChevronRight style={{ width: 15, height: 15 }} /></IconButton>
                </span>
              )}
              <button type="button" onClick={() => setMode('dock')} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', background: 'var(--color-card)' }}>
                <X style={{ width: 14, height: 14 }} /> Back to board
              </button>
            </header>
            <div style={{ flex: 1, minHeight: 0, display: 'grid', alignContent: 'center', justifyContent: 'center', gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`, gap: 12, width: '100%', maxWidth: gridMaxWidth, margin: '0 auto' }}>
              <AnimatePresence initial={false}>
                {gridTiles.map(t => <VideoTile key={t.sessionId} tile={t} size="grid" />)}
              </AnimatePresence>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
