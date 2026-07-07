import { useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import ToolSidebar from '@/components/board/ToolSidebar'
import CanvasArea from '@/components/board/CanvasArea'
import { useBoardStore } from '@/stores/boardStore'
import type { ToolType } from '@/types'

const PREVIEW_BOARD_ID = 'preview-local'

/** Offline canvas playground — no backend or MongoDB required. */
export default function CanvasPreviewPage() {
  const { setBoard, setElements, clearSelection, undo, redo } = useBoardStore()

  useEffect(() => {
    setBoard({
      _id: 'preview',
      title: 'Canvas Preview',
      roomId: PREVIEW_BOARD_ID,
      persistent: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    setElements([])
    toast.info('Offline preview — draw and test tools here', { duration: 4000 })
    return () => {
      setBoard(null)
      setElements([])
    }
  }, [setBoard, setElements])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const store = useBoardStore.getState()
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (store.selectedElementIds.length > 0) {
        e.preventDefault()
        store.deleteSelectedElements()
      }
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      }
      if (e.key === 'y') {
        e.preventDefault()
        redo()
      }
      if (e.key === 'a') {
        e.preventDefault()
        store.selectAll()
      }
    }

    if (e.key === 'Escape') clearSelection()

    const toolMap: Record<string, ToolType> = {
      v: 'select', h: 'hand', p: 'pen', r: 'rectangle', c: 'circle',
      l: 'line', t: 'text', s: 'sticky', e: 'eraser', f: 'frame',
    }
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && toolMap[e.key]) {
      store.setActiveTool(toolMap[e.key])
    }
    if (e.shiftKey && e.key === 'A') {
      e.preventDefault()
      store.setActiveTool('arrow')
    }
  }, [clearSelection, undo, redo])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', overflow: 'hidden' }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px', borderBottom: '1px solid var(--color-border)',
          background: 'color-mix(in srgb, var(--color-card) 90%, transparent)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <Link
          to="/"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, color: 'var(--color-muted-foreground)', textDecoration: 'none',
          }}
        >
          <ArrowLeft style={{ width: 16, height: 16 }} />
          Home
        </Link>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-foreground)' }}>
          Canvas Preview
        </span>
        <span
          style={{
            marginLeft: 8, fontSize: 11, fontWeight: 600,
            padding: '3px 8px', borderRadius: 999,
            background: 'rgba(99,102,241,0.12)', color: 'var(--color-accent)',
          }}
        >
          Offline mode
        </span>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <CanvasArea boardId={PREVIEW_BOARD_ID} />
        <ToolSidebar />
      </div>
    </div>
  )
}
