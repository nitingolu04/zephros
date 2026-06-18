import { useMemo, useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Presentation, X } from 'lucide-react'
import { useBoardStore } from '@/stores/boardStore'

interface Props {
  onClose: () => void
}

export default function PresentationMode({ onClose }: Props) {
  const elements = useBoardStore((s) => s.elements)
  const setStageScale = useBoardStore((s) => s.setStageScale)
  const setStagePosition = useBoardStore((s) => s.setStagePosition)

  const frames = useMemo(
    () => elements.filter((el) => el.type === 'frame').sort((a, b) => a.x - b.x || a.y - b.y),
    [elements],
  )
  const [index, setIndex] = useState(0)

  const goTo = (i: number) => {
    const frame = frames[i]
    if (!frame) return
    setIndex(i)
    const fw = frame.width || 400
    const fh = frame.height || 300
    const pad = 48
    const vw = window.innerWidth * 0.7
    const vh = window.innerHeight * 0.65
    const scale = Math.min((vw - pad) / fw, (vh - pad) / fh, 2)
    setStageScale(scale)
    setStagePosition({
      x: (vw - fw * scale) / 2 - frame.x * scale + 56,
      y: (vh - fh * scale) / 2 - frame.y * scale + 52,
    })
  }

  useEffect(() => {
    if (frames.length > 0) goTo(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (frames.length === 0) {
    return (
      <div className="fixed inset-x-0 bottom-24 z-50 mx-auto max-w-md rounded-2xl border border-border bg-card p-4 shadow-xl">
        <p className="text-sm text-muted-foreground">Add frame elements to use presentation mode.</p>
        <button type="button" onClick={onClose} className="mt-3 text-sm text-accent">Close</button>
      </div>
    )
  }

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-2 rounded-2xl border border-border bg-card/95 px-3 py-2 shadow-xl backdrop-blur-xl">
      <Presentation className="h-4 w-4 text-accent" />
      <span className="max-w-[120px] truncate text-xs font-medium">
        {frames[index]?.text || `Frame ${index + 1}`}
      </span>
      <span className="text-xs text-muted-foreground">{index + 1}/{frames.length}</span>
      <button type="button" onClick={() => goTo(Math.max(0, index - 1))} className="rounded-lg p-1.5 hover:bg-muted">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => goTo(Math.min(frames.length - 1, index + 1))} className="rounded-lg p-1.5 hover:bg-muted">
        <ChevronRight className="h-4 w-4" />
      </button>
      <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
