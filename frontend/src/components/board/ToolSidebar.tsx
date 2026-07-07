import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MousePointer2, Hand, Pencil, Highlighter, PenLine, Square, Circle, Minus,
  ArrowUpRight, Type, StickyNote, Eraser, Crosshair, Smile, Frame,
  Undo2, Redo2, Plus, Sparkles, Lasso, Shapes, ChevronRight, MoreHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'
import { useBoardStore } from '@/stores/boardStore'
import { socketService } from '@/services/socket'
import { createImageElement, createElementsFromPdf } from '@/lib/canvasImport'
import type { ToolType, PenMode } from '@/types'

const shapeTools: { type: ToolType; icon: typeof Square; label: string; shortcut: string }[] = [
  { type: 'rectangle', icon: Square, label: 'Rectangle', shortcut: 'R' },
  { type: 'circle', icon: Circle, label: 'Circle', shortcut: 'C' },
  { type: 'line', icon: Minus, label: 'Line', shortcut: 'L' },
  { type: 'arrow', icon: ArrowUpRight, label: 'Arrow', shortcut: 'Shift+A' },
]

const noteTools: { type: ToolType; icon: typeof Type; label: string; shortcut: string }[] = [
  { type: 'text', icon: Type, label: 'Text', shortcut: 'T' },
  { type: 'sticky', icon: StickyNote, label: 'Sticky note', shortcut: 'S' },
]

const moreTools: { type: ToolType; icon: typeof Frame; label: string; shortcut?: string }[] = [
  { type: 'frame', icon: Frame, label: 'Frame', shortcut: 'F' },
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
const shapeTypes = new Set(shapeTools.map((t) => t.type))
const noteTypes = new Set(noteTools.map((t) => t.type))

function ToolbarButton({
  active, title, onClick, children, className = '', compact = false,
}: {
  active?: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      title={title}
      className={`toolbar-btn ${compact ? 'toolbar-btn-compact' : ''} ${active ? 'active' : ''} ${className}`}
    >
      {children}
    </motion.button>
  )
}

function FlyoutMenu({
  open, onClose, items, activeType, onSelect, top,
}: {
  open: boolean
  onClose: () => void
  items: { type: ToolType; icon: typeof Square; label: string; shortcut?: string }[]
  activeType: ToolType
  onSelect: (type: ToolType) => void
  top: number
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={onClose} aria-hidden />
          <motion.div
            initial={{ opacity: 0, x: -6, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -6, scale: 0.96 }}
            className="floating-toolbar toolbar-flyout"
            style={{ top }}
          >
            {items.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => { onSelect(item.type); onClose() }}
                className={`toolbar-flyout-item ${activeType === item.type ? 'active' : ''}`}
              >
                <item.icon style={{ width: 16, height: 16, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.shortcut && (
                  <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)' }}>{item.shortcut}</span>
                )}
              </button>
            ))}
          </motion.div>
        </>
      )}
    </AnimatePresence>
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

  const [lastShape, setLastShape] = useState<ToolType>('rectangle')
  const [lastNote, setLastNote] = useState<ToolType>('text')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [openMenu, setOpenMenu] = useState<{ id: string; top: number } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const mainBarRef = useRef<HTMLDivElement>(null)

  const boardId = board?.roomId
  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1

  const currentShape = shapeTypes.has(activeTool) ? activeTool : lastShape
  const currentNote = noteTypes.has(activeTool) ? activeTool : lastNote
  const ShapeIcon = shapeTools.find((t) => t.type === currentShape)?.icon ?? Shapes
  const NoteIcon = noteTools.find((t) => t.type === currentNote)?.icon ?? Type

  const needsContextPanel = ['pen', 'eraser', ...shapeTools.map((t) => t.type)].includes(activeTool)
  const anyMenuOpen = openMenu !== null
  const showContextPanel = needsContextPanel && !anyMenuOpen
  const needsText = noteTypes.has(activeTool) && !anyMenuOpen
  const reactionEmojis = ['👍', '❤️', '🔥', '😂', '🎉', '👏', '💡', '✅']

  const closeMenus = () => {
    setOpenMenu(null)
    setShowColorPicker(false)
  }

  const toggleMenu = (id: string, rowEl: HTMLElement) => {
    if (!mainBarRef.current) return
    const top = rowEl.offsetTop
    setOpenMenu((prev) => (prev?.id === id ? null : { id, top }))
    setShowColorPicker(false)
  }

  const pickShape = (type: ToolType) => {
    setLastShape(type)
    setActiveTool(type)
    closeMenus()
  }

  const pickNote = (type: ToolType) => {
    setLastNote(type)
    setActiveTool(type)
    closeMenus()
  }

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

  const barStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 1,
    padding: '6px 4px',
  }

  const clusterStyle: React.CSSProperties = {
    position: 'absolute',
    left: 16,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 30,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    pointerEvents: 'none',
  }

  return (
    <div style={clusterStyle}>
      <div ref={mainBarRef} className="floating-toolbar pointer-events-auto" style={barStyle}>
        <div id="menu-row-quick">
          <ToolbarButton compact className="ai-btn" title="Quick add" onClick={() => {
            const row = mainBarRef.current?.querySelector('#menu-row-quick') as HTMLElement
            if (row) toggleMenu('quick', row)
          }}>
            <Sparkles style={{ width: 18, height: 18 }} />
          </ToolbarButton>
        </div>

        <div className="toolbar-divider" />

        <ToolbarButton compact active={activeTool === 'select'} title="Select (V)" onClick={() => { closeMenus(); setActiveTool('select') }}>
          <MousePointer2 style={{ width: 17, height: 17 }} />
        </ToolbarButton>
        <ToolbarButton compact active={activeTool === 'hand'} title="Pan (H)" onClick={() => { closeMenus(); setActiveTool('hand') }}>
          <Hand style={{ width: 17, height: 17 }} />
        </ToolbarButton>

        <div style={{ display: 'flex', alignItems: 'center' }} id="menu-row-shape">
          <ToolbarButton
            compact
            active={shapeTypes.has(activeTool)}
            title={`Shape: ${shapeTools.find((t) => t.type === currentShape)?.label}`}
            onClick={() => { closeMenus(); pickShape(currentShape) }}
          >
            <ShapeIcon style={{ width: 17, height: 17 }} />
          </ToolbarButton>
          <button
            type="button"
            title="More shapes"
            onClick={(e) => {
              const row = (e.currentTarget as HTMLElement).parentElement!
              toggleMenu('shape', row)
            }}
            style={{
              width: 14, height: 34, border: 'none', cursor: 'pointer',
              background: openMenu?.id === 'shape' ? 'var(--color-muted)' : 'transparent',
              color: 'var(--color-muted-foreground)', borderRadius: '0 8px 8px 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: -4,
            }}
          >
            <ChevronRight style={{ width: 12, height: 12 }} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center' }} id="menu-row-note">
          <ToolbarButton
            compact
            active={noteTypes.has(activeTool)}
            title={`Note: ${noteTools.find((t) => t.type === currentNote)?.label}`}
            onClick={() => { closeMenus(); pickNote(currentNote) }}
          >
            <NoteIcon style={{ width: 17, height: 17 }} />
          </ToolbarButton>
          <button
            type="button"
            title="More note types"
            onClick={(e) => toggleMenu('note', (e.currentTarget as HTMLElement).parentElement!)}
            style={{
              width: 14, height: 34, border: 'none', cursor: 'pointer',
              background: openMenu?.id === 'note' ? 'var(--color-muted)' : 'transparent',
              color: 'var(--color-muted-foreground)', borderRadius: '0 8px 8px 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: -4,
            }}
          >
            <ChevronRight style={{ width: 12, height: 12 }} />
          </button>
        </div>

        <ToolbarButton compact active={activeTool === 'pen'} title="Draw (P)" onClick={() => { closeMenus(); setActiveTool('pen') }}>
          <Pencil style={{ width: 17, height: 17 }} />
        </ToolbarButton>
        <ToolbarButton compact active={activeTool === 'eraser'} title="Eraser (E)" onClick={() => { closeMenus(); setActiveTool('eraser') }}>
          <Eraser style={{ width: 17, height: 17 }} />
        </ToolbarButton>

        <div className="toolbar-divider" />

        <div id="menu-row-more">
          <ToolbarButton
            compact
            active={moreTools.some((t) => t.type === activeTool)}
            title="More tools"
            onClick={() => toggleMenu('more', mainBarRef.current!.querySelector('#menu-row-more') as HTMLElement)}
          >
            <MoreHorizontal style={{ width: 17, height: 17 }} />
          </ToolbarButton>
        </div>

        <input ref={importRef} type="file" accept="image/*,.pdf,application/pdf" className="hidden" onChange={(e) => { void handleImport(e) }} />
        <ToolbarButton compact title="Import image or PDF" onClick={() => importRef.current?.click()}>
          <Plus style={{ width: 17, height: 17 }} />
        </ToolbarButton>

        <div className="toolbar-divider" />

        <div style={{ display: 'flex', gap: 1 }}>
          <ToolbarButton compact title="Undo" onClick={undo} className={!canUndo ? 'opacity-40' : ''}>
            <Undo2 style={{ width: 15, height: 15 }} />
          </ToolbarButton>
          <ToolbarButton compact title="Redo" onClick={redo} className={!canRedo ? 'opacity-40' : ''}>
            <Redo2 style={{ width: 15, height: 15 }} />
          </ToolbarButton>
        </div>

        <FlyoutMenu
          open={openMenu?.id === 'quick'}
          top={openMenu?.id === 'quick' ? openMenu.top : 0}
          onClose={closeMenus}
          activeType={activeTool}
          items={[
            { type: 'sticky', icon: StickyNote, label: 'Sticky note', shortcut: 'S' },
            { type: 'text', icon: Type, label: 'Text block', shortcut: 'T' },
            { type: 'frame', icon: Frame, label: 'Frame', shortcut: 'F' },
          ]}
          onSelect={(type) => { setActiveTool(type); closeMenus() }}
        />
        <FlyoutMenu
          open={openMenu?.id === 'shape'}
          top={openMenu?.id === 'shape' ? openMenu.top : 0}
          onClose={closeMenus}
          activeType={currentShape}
          items={shapeTools}
          onSelect={pickShape}
        />
        <FlyoutMenu
          open={openMenu?.id === 'note'}
          top={openMenu?.id === 'note' ? openMenu.top : 0}
          onClose={closeMenus}
          activeType={currentNote}
          items={noteTools}
          onSelect={pickNote}
        />
        <FlyoutMenu
          open={openMenu?.id === 'more'}
          top={openMenu?.id === 'more' ? openMenu.top : 0}
          onClose={closeMenus}
          activeType={activeTool}
          items={moreTools}
          onSelect={(type) => { setActiveTool(type); closeMenus() }}
        />
      </div>

      <AnimatePresence>
        {showContextPanel && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            className="floating-toolbar pointer-events-auto"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 1, padding: '6px 4px', flexShrink: 0,
            }}
          >
            {activeTool === 'pen' && penModes.map((pm) => (
              <ToolbarButton key={pm.mode} compact active={penMode === pm.mode} title={pm.label} onClick={() => handlePenModeSelect(pm.mode)}>
                <pm.icon style={{ width: 16, height: 16 }} />
              </ToolbarButton>
            ))}

            {activeTool === 'eraser' && (
              <>
                <ToolbarButton compact active title="Eraser" onClick={() => {}}>
                  <Eraser style={{ width: 16, height: 16 }} />
                </ToolbarButton>
                <ToolbarButton compact title="Lasso (soon)" onClick={() => toast.info('Coming soon')}>
                  <Lasso style={{ width: 16, height: 16, opacity: 0.45 }} />
                </ToolbarButton>
              </>
            )}

            <div style={{ position: 'relative' }}>
              <ToolbarButton compact active={showColorPicker} title="Color & stroke" onClick={() => setShowColorPicker(!showColorPicker)}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', background: toolColor,
                  boxShadow: `0 0 0 2px var(--color-card), 0 0 0 3px ${toolColor}`,
                }}
                />
              </ToolbarButton>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, marginTop: 3 }}>
                {quickColors.filter((c) => c !== toolColor).slice(0, 2).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setToolColor(c)}
                    style={{
                      width: 14, height: 14, borderRadius: '50%', background: c,
                      border: '2px solid var(--color-card)', cursor: 'pointer',
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
                      position: 'absolute', left: 'calc(100% + 8px)', top: 0, zIndex: 50,
                      borderRadius: 14, border: '1px solid var(--color-border)',
                      background: 'var(--color-card)', padding: 12,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.15)', minWidth: 150,
                    }}
                  >
                    <p className="toolbar-panel-label">Color</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, marginBottom: 12 }}>
                      {colors.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setToolColor(color)}
                          style={{
                            width: 22, height: 22, borderRadius: '50%', border: 'none',
                            background: color, cursor: 'pointer',
                            outline: toolColor === color ? '2px solid var(--color-accent)' : 'none',
                            outlineOffset: 2,
                          }}
                        />
                      ))}
                    </div>
                    <p className="toolbar-panel-label">Stroke</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {strokeWidths.map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => { setToolStrokeWidth(w); setShowColorPicker(false) }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '5px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                            background: toolStrokeWidth === w ? 'rgba(99,102,241,0.12)' : 'transparent',
                            color: toolStrokeWidth === w ? 'var(--color-accent)' : 'var(--color-foreground)',
                          }}
                        >
                          <div style={{ width: 36, display: 'flex', alignItems: 'center' }}>
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

      <AnimatePresence>
        {needsText && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            className="floating-toolbar pointer-events-auto"
            style={{ padding: 12, minWidth: 180, flexShrink: 0 }}
          >
            <p className="toolbar-panel-label">Text</p>
            <select
              title="Font Size"
              value={textFontSize}
              onChange={(e) => setTextFontSize(Number(e.target.value))}
              className="toolbar-select"
            >
              {[12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((s) => (
                <option key={s} value={s}>{s}px</option>
              ))}
            </select>
            <select
              title="Font Family"
              value={textFontFamily}
              onChange={(e) => setTextFontFamily(e.target.value)}
              className="toolbar-select"
              style={{ marginTop: 8 }}
            >
              {['Inter', 'Arial', 'Georgia', 'Courier New', 'Comic Sans MS'].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </motion.div>
        )}
      </AnimatePresence>

      {activeTool === 'reaction' && (
        <div
          className="floating-toolbar pointer-events-auto"
          style={{
            display: 'flex', flexWrap: 'wrap', gap: 4, padding: 8, maxWidth: 140, flexShrink: 0,
          }}
        >
          {reactionEmojis.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setReactionEmoji(e)}
              style={{
                width: 32, height: 32, borderRadius: 8, fontSize: 16,
                border: reactionEmoji === e ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: 'var(--color-surface-1)', cursor: 'pointer',
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
