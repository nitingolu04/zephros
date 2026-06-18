import { useRef, useEffect } from 'react'
import { Maximize2, Minimize2, X, GripVertical } from 'lucide-react'
import { useBoardStore } from '@/stores/boardStore'

interface Props {
  stream: MediaStream | null
  username?: string
  isLocal?: boolean
  connecting?: boolean
  onClose?: () => void
}

export default function ScreenSharePanel({ stream, username, isLocal, connecting, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const panelWidth = useBoardStore((s) => s.screenSharePanelWidth)
  const setPanelWidth = useBoardStore((s) => s.setScreenSharePanelWidth)

  useEffect(() => {
    const el = videoRef.current
    if (!el || !stream) {
      if (el) el.srcObject = null
      return
    }
    el.srcObject = stream
    void el.play().catch(() => {})
  }, [stream])

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidth

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
      setPanelWidth(Math.min(640, Math.max(200, startW + delta)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (!stream && !connecting) return null

  return (
    <div
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-card/95"
      style={{ width: panelWidth }}
    >
      <div
        className="absolute left-0 top-0 z-10 flex h-full w-1.5 cursor-col-resize items-center justify-center hover:bg-accent/30"
        onMouseDown={onResizeStart}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 hover:opacity-100" />
      </div>

      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="truncate text-xs font-medium text-foreground">
          {isLocal ? 'Your screen' : `${username || 'Presenter'}'s screen`}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setPanelWidth(panelWidth >= 500 ? 280 : 560)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Resize"
          >
            {panelWidth >= 500 ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          {isLocal && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden bg-black/90 p-2">
        {stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        ) : (
          <p className="text-sm text-muted-foreground animate-pulse">Connecting to screen share…</p>
        )}
      </div>
    </div>
  )
}
