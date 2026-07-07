import { useRef, useCallback, useState, useEffect } from 'react'
import { Stage, Layer, Rect, Circle, Line, Arrow, Text, Group } from 'react-konva'
import { Grid3x3, Minus, Plus, Maximize2, Magnet } from 'lucide-react'
import type Konva from 'konva'
import { useBoardStore } from '@/stores/boardStore'
import { socketService } from '@/services/socket'
import { generateId } from '@/lib/utils'
import { createFrameElement } from '@/lib/canvasImport'
import { CanvasImageNode, CanvasFrameNode } from '@/components/board/CanvasNodes'
import type { CanvasElement, CursorPosition } from '@/types'

const GRID_SIZE = 24

interface Props {
  boardId: string
}

function snapValue(value: number, enabled: boolean) {
  return enabled ? Math.round(value / GRID_SIZE) * GRID_SIZE : value
}

function getPenStyle(penMode: string, toolColor: string, toolStrokeWidth: number) {
  if (penMode === 'highlighter') {
    return { stroke: toolColor, strokeWidth: Math.max(toolStrokeWidth, 10), opacity: 0.35 }
  }
  if (penMode === 'marker') {
    return { stroke: toolColor, strokeWidth: Math.max(toolStrokeWidth, 5), opacity: 0.85 }
  }
  return { stroke: toolColor, strokeWidth: toolStrokeWidth, opacity: 1 }
}

export default function CanvasArea({ boardId }: Props) {
  const stageRef = useRef<Konva.Stage>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const {
    elements, selectedElementIds, activeTool, penMode, toolColor, toolStrokeWidth,
    stageScale, stagePosition, cursors, laserPoints, canvasReactions, reactionEmoji,
    drawingUsers, showGrid, snapToGrid,
    addElement, updateElement, selectElement, clearSelection,
    setStageScale, setStagePosition, deleteElement, setActiveTool,
    setShowGrid, setSnapToGrid, fitToView,
  } = useBoardStore()

  const [isLasering, setIsLasering] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0, stageX: 0, stageY: 0 })
  const [drawingPoints, setDrawingPoints] = useState<number[]>([])
  const [newShapeStart, setNewShapeStart] = useState<{ x: number; y: number } | null>(null)
  const [tempElement, setTempElement] = useState<Partial<CanvasElement> | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 })

  const [editingElementId, setEditingElementId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [editingPos, setEditingPos] = useState({ x: 0, y: 0, width: 200, height: 100 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })
    observer.observe(container)
    setContainerSize({ width: container.offsetWidth, height: container.offsetHeight })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      useBoardStore.getState().pruneLasers()
      useBoardStore.getState().pruneCanvasReactions()
    }, 400)
    return () => clearInterval(t)
  }, [])

  const getPointerPos = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return { x: 0, y: 0 }
    const pos = stage.getPointerPosition()
    if (!pos) return { x: 0, y: 0 }
    const raw = {
      x: (pos.x - stagePosition.x) / stageScale,
      y: (pos.y - stagePosition.y) / stageScale,
    }
    return {
      x: snapValue(raw.x, snapToGrid),
      y: snapValue(raw.y, snapToGrid),
    }
  }, [stageScale, stagePosition, snapToGrid])

  const setDrawingPresence = useCallback((drawing: boolean) => {
    socketService.emitUserDrawing(boardId, drawing)
  }, [boardId])

  const finishTextEditing = useCallback(() => {
    if (!editingElementId) return
    const text = editingText.trim() || 'Text'
    updateElement(editingElementId, { text })
    socketService.emitUpdateElement(boardId, editingElementId, { text })
    setEditingElementId(null)
    setEditingText('')
  }, [editingElementId, editingText, boardId, updateElement])

  const handleElementDblClick = useCallback((el: CanvasElement) => {
    if (el.type !== 'text' && el.type !== 'sticky') return
    const stage = stageRef.current
    if (!stage) return

    setEditingElementId(el.id)
    setEditingText(el.text || '')

    const stageBox = stage.container().getBoundingClientRect()
    const elX = el.x * stageScale + stagePosition.x + stageBox.left
    const elY = el.y * stageScale + stagePosition.y + stageBox.top

    if (el.type === 'sticky') {
      setEditingPos({
        x: elX + 12 * stageScale,
        y: elY + 12 * stageScale,
        width: ((el.width || 200) - 24) * stageScale,
        height: ((el.height || 160) - 24) * stageScale,
      })
    } else {
      setEditingPos({
        x: elX,
        y: elY,
        width: 300 * stageScale,
        height: 40 * stageScale,
      })
    }

    setTimeout(() => textareaRef.current?.focus(), 10)
  }, [stageScale, stagePosition])

  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (editingElementId) {
      finishTextEditing()
      return
    }

    const pos = getPointerPos()
    const stage = stageRef.current

    if (activeTool === 'hand' && stage) {
      const pointer = stage.getPointerPosition()
      if (pointer) {
        setIsPanning(true)
        setPanStart({
          x: pointer.x,
          y: pointer.y,
          stageX: stagePosition.x,
          stageY: stagePosition.y,
        })
      }
      return
    }

    if (activeTool === 'reaction') {
      socketService.emitCanvasReaction(boardId, pos.x, pos.y, reactionEmoji)
      useBoardStore.getState().addCanvasReaction({
        id: generateId(),
        sessionId: socketService.sessionId,
        username: socketService.username,
        x: pos.x, y: pos.y,
        emoji: reactionEmoji,
        expiresAt: Date.now() + 3000,
      })
      return
    }

    if (activeTool === 'laser') {
      setIsLasering(true)
      socketService.emitLaserPointer(boardId, pos.x, pos.y)
      return
    }

    const clickedOnEmpty = e.target === e.target.getStage()

    if (activeTool === 'select') {
      if (clickedOnEmpty) clearSelection()
      return
    }

    if (activeTool === 'eraser') {
      setIsDrawing(true)
      setDrawingPresence(true)
      return
    }

    if (activeTool === 'text' && clickedOnEmpty) {
      const { textFontSize, textFontFamily, textBold, textItalic, textUnderline } = useBoardStore.getState()
      const fontStyle = [textBold ? 'bold' : '', textItalic ? 'italic' : ''].filter(Boolean).join(' ') || 'normal'
      const el: CanvasElement = {
        id: generateId(), boardId, type: 'text',
        x: pos.x, y: pos.y, text: 'Text',
        fontSize: textFontSize, fontFamily: textFontFamily, fill: toolColor,
        fontStyle, textDecoration: textUnderline ? 'underline' : '',
        draggable: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      addElement(el)
      socketService.emitAddElement(boardId, el)
      setActiveTool('select')
      setTimeout(() => handleElementDblClick(el), 50)
      return
    }

    if (activeTool === 'sticky' && clickedOnEmpty) {
      const el: CanvasElement = {
        id: generateId(), boardId, type: 'sticky',
        x: pos.x, y: pos.y, width: 200, height: 160,
        fill: '#FEF3C7', text: 'Type here...', fontSize: 14, fontFamily: 'Inter',
        cornerRadius: 12, draggable: true,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      addElement(el)
      socketService.emitAddElement(boardId, el)
      setActiveTool('select')
      setTimeout(() => handleElementDblClick(el), 50)
      return
    }

    if (activeTool === 'pen') {
      setIsDrawing(true)
      setDrawingPoints([pos.x, pos.y])
      setDrawingPresence(true)
      return
    }

    if (['rectangle', 'circle', 'line', 'arrow', 'frame'].includes(activeTool)) {
      setIsDrawing(true)
      setNewShapeStart(pos)
      setDrawingPresence(true)
    }
  }, [activeTool, boardId, toolColor, addElement, clearSelection, getPointerPos, editingElementId, finishTextEditing, setActiveTool, handleElementDblClick, setDrawingPresence, stagePosition, reactionEmoji])

  const handleMouseMove = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return

    if (isPanning) {
      const pointer = stage.getPointerPosition()
      if (pointer) {
        setStagePosition({
          x: panStart.stageX + (pointer.x - panStart.x),
          y: panStart.stageY + (pointer.y - panStart.y),
        })
      }
      return
    }

    const pos = getPointerPos()
    socketService.emitCursorMove(boardId, pos.x, pos.y)

    if (activeTool === 'laser' && isLasering) {
      socketService.emitLaserPointer(boardId, pos.x, pos.y)
      useBoardStore.getState().addLaserPoint({
        sessionId: socketService.sessionId,
        username: socketService.username,
        color: socketService.color,
        x: pos.x, y: pos.y,
        expiresAt: Date.now() + 2000,
      })
      return
    }

    if (!isDrawing) return

    if (activeTool === 'pen') {
      setDrawingPoints((prev) => [...prev, pos.x, pos.y])
      return
    }

    if (newShapeStart && ['rectangle', 'circle', 'line', 'arrow', 'frame'].includes(activeTool)) {
      setTempElement({
        x: newShapeStart.x, y: newShapeStart.y,
        width: pos.x - newShapeStart.x,
        height: pos.y - newShapeStart.y,
        points: [newShapeStart.x, newShapeStart.y, pos.x, pos.y],
      })
    }
  }, [isPanning, panStart, isDrawing, activeTool, boardId, newShapeStart, getPointerPos, isLasering, setStagePosition])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
    setIsLasering(false)
    if (isDrawing) setDrawingPresence(false)
    if (!isDrawing) return
    setIsDrawing(false)

    const penStyle = getPenStyle(penMode, toolColor, toolStrokeWidth)

    if (activeTool === 'pen' && drawingPoints.length > 2) {
      const el: CanvasElement = {
        id: generateId(), boardId, type: 'pen',
        x: 0, y: 0, points: drawingPoints,
        stroke: penStyle.stroke, strokeWidth: penStyle.strokeWidth,
        opacity: penStyle.opacity,
        draggable: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      addElement(el)
      socketService.emitAddElement(boardId, el)
      setDrawingPoints([])
      return
    }

    if (newShapeStart && tempElement) {
      const pos = getPointerPos()
      const w = Math.abs(pos.x - newShapeStart.x)
      const h = Math.abs(pos.y - newShapeStart.y)
      if (w < 5 && h < 5) { setNewShapeStart(null); setTempElement(null); return }

      if (activeTool === 'frame') {
        const el = createFrameElement(
          boardId,
          Math.min(newShapeStart.x, pos.x),
          Math.min(newShapeStart.y, pos.y),
          w, h,
          `Frame ${elements.filter((e) => e.type === 'frame').length + 1}`,
        )
        addElement(el)
        socketService.emitAddElement(boardId, el)
        setNewShapeStart(null)
        setTempElement(null)
        return
      }

      const el: CanvasElement = {
        id: generateId(), boardId,
        type: activeTool as CanvasElement['type'],
        x: Math.min(newShapeStart.x, pos.x),
        y: Math.min(newShapeStart.y, pos.y),
        width: w, height: h,
        points: activeTool === 'line' || activeTool === 'arrow'
          ? [newShapeStart.x, newShapeStart.y, pos.x, pos.y] : undefined,
        fill: activeTool === 'line' || activeTool === 'arrow' ? undefined : toolColor + '30',
        stroke: toolColor, strokeWidth: toolStrokeWidth,
        draggable: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      addElement(el)
      socketService.emitAddElement(boardId, el)
      setNewShapeStart(null)
      setTempElement(null)
    }
  }, [isDrawing, activeTool, boardId, drawingPoints, newShapeStart, tempElement, toolColor, toolStrokeWidth, penMode, addElement, getPointerPos, setDrawingPresence, elements])

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const oldScale = stageScale
    const pointer = stage.getPointerPosition()!
    const scaleBy = 1.08
    const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy
    const clampedScale = Math.max(0.1, Math.min(5, newScale))

    setStageScale(clampedScale)
    setStagePosition({
      x: pointer.x - (pointer.x - stagePosition.x) * (clampedScale / oldScale),
      y: pointer.y - (pointer.y - stagePosition.y) * (clampedScale / oldScale),
    })
  }, [stageScale, stagePosition, setStageScale, setStagePosition])

  const handleElementClick = useCallback((el: CanvasElement, e?: Konva.KonvaEventObject<MouseEvent>) => {
    if (activeTool === 'eraser') {
      e?.cancelBubble && (e.cancelBubble = true)
      deleteElement(el.id)
      socketService.emitDeleteElement(boardId, el.id)
      return
    }
    if (activeTool === 'select') {
      selectElement(el.id)
    }
  }, [activeTool, boardId, deleteElement, selectElement])

  const handleElementMouseEnter = useCallback((el: CanvasElement) => {
    if (activeTool === 'eraser' && isDrawing) {
      deleteElement(el.id)
      socketService.emitDeleteElement(boardId, el.id)
    }
  }, [activeTool, isDrawing, boardId, deleteElement])

  const handleDragEnd = useCallback((el: CanvasElement, e: Konva.KonvaEventObject<DragEvent>) => {
    const changes = {
      x: snapValue(e.target.x(), snapToGrid),
      y: snapValue(e.target.y(), snapToGrid),
    }
    updateElement(el.id, changes)
    socketService.emitUpdateElement(boardId, el.id, changes)
  }, [boardId, updateElement, snapToGrid])

  const renderElement = (el: CanvasElement) => {
    const isSelected = selectedElementIds.includes(el.id)
    const isBeingEdited = editingElementId === el.id
    const commonProps = {
      draggable: activeTool === 'select' && !isBeingEdited,
      onClick: (e: Konva.KonvaEventObject<MouseEvent>) => handleElementClick(el, e),
      onTap: () => handleElementClick(el),
      onDblClick: () => handleElementDblClick(el),
      onDblTap: () => handleElementDblClick(el),
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => handleDragEnd(el, e),
      onMouseEnter: () => handleElementMouseEnter(el),
    }

    switch (el.type) {
      case 'rectangle':
        return (
          <Rect key={el.id} {...commonProps}
            x={el.x} y={el.y} width={el.width || 100} height={el.height || 100}
            fill={el.fill} stroke={isSelected ? '#6366F1' : el.stroke}
            strokeWidth={isSelected ? 2 : el.strokeWidth}
            cornerRadius={8} rotation={el.rotation}
          />
        )
      case 'circle':
        return (
          <Circle key={el.id} {...commonProps}
            x={el.x + (el.width || 50) / 2} y={el.y + (el.height || 50) / 2}
            radius={Math.min(el.width || 50, el.height || 50) / 2}
            fill={el.fill} stroke={isSelected ? '#6366F1' : el.stroke}
            strokeWidth={isSelected ? 2 : el.strokeWidth}
          />
        )
      case 'line':
        return (
          <Line key={el.id} {...commonProps}
            points={el.points || []}
            stroke={isSelected ? '#6366F1' : el.stroke}
            strokeWidth={isSelected ? 2 : el.strokeWidth}
            lineCap="round"
          />
        )
      case 'arrow':
        return (
          <Arrow key={el.id} {...commonProps}
            points={el.points || []}
            stroke={isSelected ? '#6366F1' : el.stroke}
            strokeWidth={isSelected ? 2 : el.strokeWidth}
            fill={el.stroke} pointerLength={10} pointerWidth={10}
            lineCap="round"
          />
        )
      case 'pen':
        return (
          <Line key={el.id} {...commonProps}
            points={el.points || []}
            stroke={isSelected ? '#6366F1' : el.stroke}
            strokeWidth={el.strokeWidth || 2}
            opacity={el.opacity ?? 1}
            tension={0.5} lineCap="round" lineJoin="round"
            globalCompositeOperation={el.opacity && el.opacity < 0.5 ? 'multiply' : 'source-over'}
          />
        )
      case 'text':
        return (
          <Text key={el.id} {...commonProps}
            x={el.x} y={el.y}
            text={isBeingEdited ? '' : (el.text || 'Text')}
            fontSize={el.fontSize || 18}
            fontFamily={el.fontFamily || 'Inter'}
            fontStyle={el.fontStyle || 'normal'}
            textDecoration={el.textDecoration || ''}
            fill={el.fill || '#E5E7EB'}
            padding={4}
            visible={!isBeingEdited}
          />
        )
      case 'sticky':
        return (
          <Group key={el.id} {...commonProps} x={el.x} y={el.y}>
            <Rect
              width={el.width || 200} height={el.height || 160}
              fill={el.fill || '#FEF3C7'}
              cornerRadius={el.cornerRadius || 12}
              stroke={isSelected ? '#6366F1' : 'rgba(0,0,0,0.08)'}
              strokeWidth={isSelected ? 2 : 1}
              shadowColor="rgba(0,0,0,0.12)" shadowBlur={10} shadowOffsetY={4}
            />
            <Text
              x={12} y={12}
              width={(el.width || 200) - 24}
              height={(el.height || 160) - 24}
              text={isBeingEdited ? '' : (el.text || 'Type here...')}
              fontSize={el.fontSize || 14}
              fontFamily="Inter" fill="#78350F" padding={4}
              visible={!isBeingEdited}
            />
          </Group>
        )
      case 'image':
        return <CanvasImageNode key={el.id} el={el} commonProps={commonProps} isSelected={isSelected} />
      case 'frame':
        return <CanvasFrameNode key={el.id} el={el} commonProps={commonProps} isSelected={isSelected} />
      default:
        return null
    }
  }

  const penPreview = getPenStyle(penMode, toolColor, toolStrokeWidth)

  const getCursor = () => {
    if (editingElementId) return 'text'
    if (activeTool === 'hand') return isPanning ? 'grabbing' : 'grab'
    if (activeTool === 'laser') return 'crosshair'
    if (activeTool === 'reaction') return 'pointer'
    if (activeTool === 'select') return 'default'
    if (activeTool === 'eraser') return 'cell'
    return 'crosshair'
  }

  const zoomIn = () => setStageScale(Math.min(5, stageScale * 1.2))
  const zoomOut = () => setStageScale(Math.max(0.1, stageScale / 1.2))

  const bgClass = showGrid ? 'canvas-grid' : 'canvas-plain'

  return (
    <div
      ref={containerRef}
      className={`relative flex-1 overflow-hidden ${bgClass}`}
      style={{ cursor: getCursor() }}
    >
      <Stage
        ref={stageRef}
        width={containerSize.width}
        height={containerSize.height}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePosition.x}
        y={stagePosition.y}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={(e) => handleMouseDown(e as unknown as Konva.KonvaEventObject<MouseEvent>)}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
        onWheel={handleWheel}
      >
        <Layer>
          {elements.map(renderElement)}

          {isDrawing && activeTool === 'pen' && drawingPoints.length > 0 && (
            <Line
              points={drawingPoints}
              stroke={penPreview.stroke}
              strokeWidth={penPreview.strokeWidth}
              opacity={penPreview.opacity * 0.8}
              tension={0.5}
              lineCap="round"
              lineJoin="round"
              globalCompositeOperation={penMode === 'highlighter' ? 'multiply' : 'source-over'}
            />
          )}

          {isDrawing && tempElement && activeTool === 'rectangle' && (
            <Rect x={tempElement.x} y={tempElement.y}
              width={tempElement.width} height={tempElement.height}
              fill={toolColor + '20'} stroke={toolColor} strokeWidth={1} dash={[4, 4]}
            />
          )}
          {isDrawing && tempElement && activeTool === 'circle' && (
            <Circle
              x={(tempElement.x || 0) + (tempElement.width || 0) / 2}
              y={(tempElement.y || 0) + (tempElement.height || 0) / 2}
              radius={Math.min(Math.abs(tempElement.width || 0), Math.abs(tempElement.height || 0)) / 2}
              fill={toolColor + '20'} stroke={toolColor} strokeWidth={1} dash={[4, 4]}
            />
          )}
          {isDrawing && tempElement && activeTool === 'line' && (
            <Line points={tempElement.points || []} stroke={toolColor} strokeWidth={2} lineCap="round" dash={[4, 4]} />
          )}
          {isDrawing && tempElement && activeTool === 'arrow' && (
            <Arrow points={tempElement.points || []} stroke={toolColor} strokeWidth={2}
              fill={toolColor} pointerLength={8} pointerWidth={8} dash={[4, 4]}
            />
          )}
          {isDrawing && tempElement && activeTool === 'frame' && (
            <Rect x={tempElement.x} y={tempElement.y}
              width={tempElement.width} height={tempElement.height}
              fill="rgba(99,102,241,0.06)" stroke={toolColor} strokeWidth={2} dash={[12, 6]} cornerRadius={8}
            />
          )}
        </Layer>

        <Layer listening={false}>
          {laserPoints.map((p) => (
            <Group key={`${p.sessionId}-${p.expiresAt}`} x={p.x} y={p.y}>
              <Circle radius={12} fill={p.color} opacity={0.35} />
              <Circle radius={5} fill={p.color} shadowColor={p.color} shadowBlur={12} />
            </Group>
          ))}
          {canvasReactions.map((r) => (
            <Text key={r.id} x={r.x} y={r.y} text={r.emoji} fontSize={36} opacity={0.9} />
          ))}
        </Layer>

        <Layer listening={false}>
          {cursors.map((cursor: CursorPosition) => {
            const isDrawingRemote = Boolean(drawingUsers[cursor.sessionId])
            const label = isDrawingRemote ? `${cursor.username} · drawing` : cursor.username
            const labelWidth = label.length * 6.5 + 12
            return (
              <Group key={cursor.sessionId} x={cursor.x} y={cursor.y}>
                <Line
                  points={[0, 0, 0, 16, 4, 12, 8, 20, 12, 18, 8, 10, 14, 10]}
                  fill={cursor.color} stroke={cursor.color} strokeWidth={0.5} closed
                />
                <Group x={16} y={14}>
                  <Rect width={labelWidth} height={20} fill={cursor.color} cornerRadius={6} />
                  <Text text={label} fontSize={10} fontFamily="Inter" fill="#FFFFFF" x={6} y={5} />
                </Group>
              </Group>
            )
          })}
        </Layer>
      </Stage>

      {editingElementId && (
        <textarea
          ref={textareaRef}
          value={editingText}
          onChange={(e) => setEditingText(e.target.value)}
          onBlur={finishTextEditing}
          onKeyDown={(e) => {
            if (e.key === 'Escape') finishTextEditing()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              finishTextEditing()
            }
          }}
          className="fixed z-50 resize-none border-2 border-accent rounded-lg bg-transparent outline-none"
          style={{
            left: editingPos.x,
            top: editingPos.y,
            width: editingPos.width,
            minHeight: editingPos.height,
            fontSize: `${14 * stageScale}px`,
            fontFamily: 'Inter',
            color: (() => {
              const el = elements.find((e) => e.id === editingElementId)
              return el?.type === 'sticky' ? '#78350F' : (el?.fill || '#E5E7EB')
            })(),
            padding: `${4 * stageScale}px`,
            lineHeight: 1.4,
          }}
        />
      )}

      {/* Bottom-right canvas controls */}
      <div
        className="canvas-controls pointer-events-auto absolute bottom-5 right-5 z-20 flex items-center gap-1 p-1.5"
      >
        <button
          type="button"
          title={showGrid ? 'Hide grid' : 'Show grid'}
          onClick={() => setShowGrid(!showGrid)}
          className={`toolbar-btn ${showGrid ? 'active' : ''}`}
          style={{ width: 36, height: 36 }}
        >
          <Grid3x3 style={{ width: 16, height: 16 }} />
        </button>
        <button
          type="button"
          title={snapToGrid ? 'Disable snap' : 'Snap to grid'}
          onClick={() => setSnapToGrid(!snapToGrid)}
          className={`toolbar-btn ${snapToGrid ? 'active' : ''}`}
          style={{ width: 36, height: 36 }}
        >
          <Magnet style={{ width: 16, height: 16 }} />
        </button>
        <div style={{ width: 1, height: 24, background: 'var(--color-border)', margin: '0 4px' }} />
        <button type="button" title="Zoom out" onClick={zoomOut} className="toolbar-btn" style={{ width: 36, height: 36 }}>
          <Minus style={{ width: 16, height: 16 }} />
        </button>
        <span style={{
          minWidth: 48, textAlign: 'center', fontSize: 12,
          fontWeight: 600, color: 'var(--color-muted-foreground)',
        }}
        >
          {Math.round(stageScale * 100)}%
        </span>
        <button type="button" title="Zoom in" onClick={zoomIn} className="toolbar-btn" style={{ width: 36, height: 36 }}>
          <Plus style={{ width: 16, height: 16 }} />
        </button>
        <div style={{ width: 1, height: 24, background: 'var(--color-border)', margin: '0 4px' }} />
        <button
          type="button"
          title="Fit to content"
          onClick={() => fitToView(containerSize.width, containerSize.height)}
          className="toolbar-btn"
          style={{ width: 36, height: 36 }}
        >
          <Maximize2 style={{ width: 16, height: 16 }} />
        </button>
      </div>
    </div>
  )
}
