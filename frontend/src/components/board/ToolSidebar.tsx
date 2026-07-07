import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MousePointer2, Hand, Pencil, Highlighter, PenLine, Square, Circle, Minus,
  ArrowUpRight, Type, StickyNote, Eraser, Crosshair, Smile, Frame,
  Undo2, Redo2, Plus, Sparkles, Lasso,
} from 'lucide-react'
import { toast } from 'sonner'
import { useBoardStore } from '@/stores/boardStore'
import { socketService } from '@/services/socket'
import { createImageElement, createElementsFromPdf } from '@/lib/canvasImport'
import type { ToolType, PenMode } from '@/types'

const mainTools: { type: ToolType; icon: typeof MousePointer2; label: string; shortcut: string }[] = [
  { type: 'select', icon: MousePointer2, label: 'Select', shortcut: 'V' },
  { type: 'hand', icon: Hand, label: 'Pan', shortcut: 'H' },
  { type: 'rectangle', icon: Square, label: 'Rectangle', shortcut: 'R' },
  { type: 'circle', icon: Circle, label: 'Circle', shortcut: 'C' },
  { type: 'line', icon: Minus, label: 'Line', shortcut: 'L' },
  { type: 'arrow', icon: ArrowUpRight, label: 'Arrow', shortcut: 'A' },
  { type: 'text', icon: Type, label: 'Text', shortcut: 'T' },
  { type: 'sticky', icon: StickyNote, label: 'Sticky Note', shortcut: 'S' },
  { type: 'pen', icon: Pencil, label: 'Draw', shortcut: 'P' },
  { type: 'frame', icon: Frame, label: 'Frame', shortcut: 'F' },
  { type: 'eraser', icon: Eraser, label: 'Eraser', shortcut: 'E' },
]

const extraTools: { type: ToolType; icon: typeof Crosshair; label: string }[] = [
  { type: 'laser', icon: Crosshair, label: 'Laser pointer' },
  { type: 'reaction', icon: Smile, label: 'React' },
]

const penModes: { mode: PenMode; icon: typeof Pencil; label: string }[] = [
  { mode: 'pen', icon: Pencil, label: 'Pen' },
  { mode: 'highlighter', icon: Highlighter, label: 'Highlighter' },
  { mode: 'marker', icon: PenLine, label: 'Marker' },
]

const colors = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4',
  '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#0F172A',
]

const strokeWidths = [1, 2, 3, 5, 8, 12]

const quickColors = ['#EF4444', '#22C55E', '#3B82F6', '#0F172A']

function ToolbarButton({
  active, title, onClick, children, className = '',
}: {
  active?: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      title={title}
      className={`toolbar-btn ${active ? 'active' : ''} ${className}`}
    >
      {children}
    </motion.button>
  )
}

export default function ToolSidebar() {
  const {
    board, activeTool, setActiveTool, penMode, setPenMode,
    toolColor, setToolColor, toolStrokeWidth, setToolStrokeWidth,
    textFontSize, setTextFontSize, textFontFamily, setTextFontFamily,
    reactionEmoji, setReactionEmoji, addElement,
    history, historyIndex, undo, redo,
  } = useBoardStore()

  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showQuickMenu, setShowQuickMenu] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const boardId = board?.roomId
  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1

  const needsContextPanel = ['pen', 'eraser', 'rectangle', 'circle', 'line', 'arrow'].includes(activeTool)
  const needsText = ['text', 'sticky'].includes(activeTool)
  const reactionEmojis = ['👍', '❤️', '🔥', '😂', '🎉', '👏', '💡', '✅']

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !boardId) return
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const els = await createElementsFromPdf(boardId, file)
        for (const el of els) {
          addElement(el)
          socketService.emitAddElement(boardId, el)
        }
        toast.success(`Imported ${els.length} PDF page${els.length === 1 ? '' : 's'}`)
      } else if (file.type.startsWith('image/')) {
        const el = await createImageElement(boardId, file)
        addElement(el)
        socketService.emitAddElement(boardId, el)
        toast.success('Image imported')
      } else {
        toast.error('Use an image or PDF file')
      }
    } catch {
      toast.error('Import failed')
    }
  }

  const handlePenModeSelect = (mode: PenMode) => {
    setPenMode(mode)
    if (mode === 'highlighter') setToolStrokeWidth(Math.max(toolStrokeWidth, 8))
    else if (mode === 'marker') setToolStrokeWidth(Math.max(toolStrokeWidth, 5))
  }

  return (
    <>
      {/* Main floating toolbar */}
      <div
        className="floating-toolbar pointer-events-auto"
        style={{
          position: 'absolute',
          left: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          padding: '8px 6px',
        }}
      >
        {/* AI quick actions */}
        <div style={{ position: 'relative' }}>
          <ToolbarButton
            className="ai-btn"
            title="Quick actions"
            onClick={() => setShowQuickMenu(!showQuickMenu)}
          >
            <Sparkles style={{ width: 20, height: 20 }} />
          </ToolbarButton>
          <AnimatePresence>
            {showQuickMenu && (
              <motion.div
                initial={{ opacity: 0, x: -8, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -8, scale: 0.95 }}
                style={{
                  position: 'absolute',
                  left: 56,
                  top: 0,
                  zIndex: 50,
                  minWidth: 180,
                  borderRadius: 14,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-card)',
                  padding: 8,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                }}
              >
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 8px 8px' }}>
                  Quick add
                </p>
                {[
                  { label: 'Sticky note', tool: 'sticky' as ToolType },
                  { label: 'Text block', tool: 'text' as ToolType },
                  { label: 'Frame', tool: 'frame' as ToolType },
                ].map((item) => (
                  <button
                    key={item.tool}
                    type="button"
                    onClick={() => { setActiveTool(item.tool); setShowQuickMenu(false) }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 12px', borderRadius: 8, border: 'none',
                      background: 'transparent', cursor: 'pointer',
                      fontSize: 13, color: 'var(--color-foreground)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-muted)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {item.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div style={{ width: 28, height: 1, background: 'var(--color-border)', margin: '4px 0' }} />

        {mainTools.map((tool) => (
          <ToolbarButton
            key={tool.type}
            active={activeTool === tool.type}
            title={`${tool.label} (${tool.shortcut})`}
            onClick={() => setActiveTool(tool.type)}
          >
            <tool.icon style={{ width: 18, height: 18 }} />
          </ToolbarButton>
        ))}

        <div style={{ width: 28, height: 1, background: 'var(--color-border)', margin: '4px 0' }} />

        {extraTools.map((tool) => (
          <ToolbarButton
            key={tool.type}
            active={activeTool === tool.type}
            title={tool.label}
            onClick={() => setActiveTool(tool.type)}
          >
            <tool.icon style={{ width: 18, height: 18 }} />
          </ToolbarButton>
        ))}

        <input
          ref={importRef}
          type="file"
          accept="image/*,.pdf,application/pdf"
          className="hidden"
          onChange={(e) => { void handleImport(e) }}
        />
        <ToolbarButton title="Import image or PDF" onClick={() => importRef.current?.click()}>
          <Plus style={{ width: 18, height: 18 }} />
        </ToolbarButton>

        <div style={{ width: 28, height: 1, background: 'var(--color-border)', margin: '4px 0' }} />

        <ToolbarButton title="Undo (Ctrl+Z)" onClick={undo} className={!canUndo ? 'opacity-40' : ''}>
          <Undo2 style={{ width: 18, height: 18 }} />
        </ToolbarButton>
        <ToolbarButton title="Redo (Ctrl+Y)" onClick={redo} className={!canRedo ? 'opacity-40' : ''}>
          <Redo2 style={{ width: 18, height: 18 }} />
        </ToolbarButton>
      </div>

      {/* Contextual sub-toolbar */}
      <AnimatePresence>
        {needsContextPanel && (
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            className="floating-toolbar pointer-events-auto"
            style={{
              position: 'absolute',
              left: 76,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 29,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              padding: '8px 6px',
            }}
          >
            {activeTool === 'pen' && penModes.map((pm) => (
              <ToolbarButton
                key={pm.mode}
                active={penMode === pm.mode}
                title={pm.label}
                onClick={() => handlePenModeSelect(pm.mode)}
              >
                <pm.icon style={{ width: 18, height: 18 }} />
              </ToolbarButton>
            ))}

            {activeTool === 'eraser' && (
              <>
                <ToolbarButton active title="Object eraser" onClick={() => {}}>
                  <Eraser style={{ width: 18, height: 18 }} />
                </ToolbarButton>
                <ToolbarButton title="Lasso select (coming soon)" onClick={() => toast.info('Lasso select coming soon')}>
                  <Lasso style={{ width: 18, height: 18, opacity: 0.4 }} />
                </ToolbarButton>
              </>
            )}

            {['rectangle', 'circle', 'line', 'arrow'].includes(activeTool) && (
              <ToolbarButton
                title="Stroke width"
                onClick={() => setShowColorPicker(!showColorPicker)}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  {[1, 2, 4].map((w) => (
                    <div key={w} style={{ width: 14, height: w, borderRadius: 2, background: 'currentColor' }} />
                  ))}
                </div>
              </ToolbarButton>
            )}

            <div style={{ position: 'relative' }}>
              <ToolbarButton
                active={showColorPicker}
                title="Color & stroke"
                onClick={() => setShowColorPicker(!showColorPicker)}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: toolColor,
                  boxShadow: `0 0 0 2px var(--color-card), 0 0 0 3.5px ${toolColor}`,
                }}
                />
              </ToolbarButton>

              {/* Quick color swatches below */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 4 }}>
                {quickColors.filter((c) => c !== toolColor).slice(0, 2).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setToolColor(c)}
                    title="Quick color"
                    style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: c, border: '2px solid var(--color-card)',
                      cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    }}
                  />
                ))}
              </div>

              <AnimatePresence>
                {showColorPicker && (
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    style={{
                      position: 'absolute',
                      left: 52,
                      top: 0,
                      zIndex: 50,
                      borderRadius: 14,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-card)',
                      padding: 14,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                      minWidth: 160,
                    }}
                  >
                    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                      Color
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 14 }}>
                      {colors.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setToolColor(color)}
                          style={{
                            width: 24, height: 24, borderRadius: '50%', border: 'none',
                            background: color, cursor: 'pointer',
                            outline: toolColor === color ? '2px solid var(--color-accent)' : 'none',
                            outlineOffset: 2,
                          }}
                        />
                      ))}
                    </div>
                    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                      Stroke
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {strokeWidths.map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => { setToolStrokeWidth(w); setShowColorPicker(false) }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                            background: toolStrokeWidth === w ? 'rgba(99,102,241,0.12)' : 'transparent',
                            color: toolStrokeWidth === w ? 'var(--color-accent)' : 'var(--color-foreground)',
                          }}
                        >
                          <div style={{ width: 40, display: 'flex', alignItems: 'center' }}>
                            <div style={{ width: '100%', height: w, borderRadius: 999, background: 'currentColor' }} />
                          </div>
                          <span style={{ fontSize: 11 }}>{w}px</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Text options panel */}
      <AnimatePresence>
        {needsText && (
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            className="floating-toolbar pointer-events-auto"
            style={{
              position: 'absolute',
              left: 76,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 29,
              padding: 14,
              minWidth: 200,
            }}
          >
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              Text
            </p>
            <select
              title="Font Size"
              value={textFontSize}
              onChange={(e) => setTextFontSize(Number(e.target.value))}
              style={{
                width: '100%', height: 36, borderRadius: 10, marginBottom: 10,
                border: '1px solid var(--color-border)', background: 'var(--color-surface-1)',
                padding: '0 10px', fontSize: 13, color: 'var(--color-foreground)', cursor: 'pointer',
              }}
            >
              {[12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((s) => (
                <option key={s} value={s}>{s}px</option>
              ))}
            </select>
            <select
              title="Font Family"
              value={textFontFamily}
              onChange={(e) => setTextFontFamily(e.target.value)}
              style={{
                width: '100%', height: 36, borderRadius: 10,
                border: '1px solid var(--color-border)', background: 'var(--color-surface-1)',
                padding: '0 10px', fontSize: 13, color: 'var(--color-foreground)', cursor: 'pointer',
              }}
            >
              {['Inter', 'Arial', 'Georgia', 'Courier New', 'Comic Sans MS'].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reaction emoji picker */}
      {activeTool === 'reaction' && (
        <div
          className="floating-toolbar pointer-events-auto"
          style={{
            position: 'absolute',
            left: 76,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 29,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            padding: 10,
            maxWidth: 160,
          }}
        >
          {reactionEmojis.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setReactionEmoji(e)}
              style={{
                width: 36, height: 36, borderRadius: 10, fontSize: 18,
                border: reactionEmoji === e ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: 'var(--color-surface-1)', cursor: 'pointer',
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
