import { create } from 'zustand'
import type {
  Board,
  CanvasElement,
  ToolType,
  PenMode,
  CursorPosition,
  ActivityEvent,
  UserSession,
  BoardMetrics,
  ChatMessage,
  LaserPoint,
  CanvasReaction,
  ScreenSharer,
  ChatMention,
} from '@/types'
import { generateId } from '@/lib/utils'

interface BoardState {
  /* Board */
  board: Board | null
  isLoading: boolean
  error: string | null

  /* Elements */
  elements: CanvasElement[]
  selectedElementIds: string[]

  /* Tool */
  activeTool: ToolType
  penMode: PenMode
  toolColor: string
  toolStrokeWidth: number
  showGrid: boolean
  snapToGrid: boolean

  /* Text formatting */
  textFontSize: number
  textFontFamily: string
  textBold: boolean
  textItalic: boolean
  textUnderline: boolean

  /* Canvas */
  stageScale: number
  stagePosition: { x: number; y: number }

  /* Collaboration */
  cursors: CursorPosition[]
  activeUsers: UserSession[]
  activityFeed: ActivityEvent[]
  chatMessages: ChatMessage[]
  metrics: BoardMetrics
  laserPoints: LaserPoint[]
  canvasReactions: CanvasReaction[]
  screenSharer: ScreenSharer | null
  screenSharePanelWidth: number
  remoteScreenStream: MediaStream | null
  reactionEmoji: string

  typingUsers: Record<string, string>
  drawingUsers: Record<string, string>

  /* History */
  history: CanvasElement[][]
  historyIndex: number

  /* Actions */
  setBoard: (board: Board | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setActiveTool: (tool: ToolType) => void
  setPenMode: (mode: PenMode) => void
  setToolColor: (color: string) => void
  setToolStrokeWidth: (width: number) => void
  setShowGrid: (show: boolean) => void
  setSnapToGrid: (snap: boolean) => void
  fitToView: (containerWidth: number, containerHeight: number) => void
  setTextFontSize: (size: number) => void
  setTextFontFamily: (family: string) => void
  setTextBold: (bold: boolean) => void
  setTextItalic: (italic: boolean) => void
  setTextUnderline: (underline: boolean) => void
  setStageScale: (scale: number) => void
  setStagePosition: (pos: { x: number; y: number }) => void

  /* Element actions */
  setElements: (elements: CanvasElement[]) => void
  addElement: (element: CanvasElement) => void
  updateElement: (id: string, changes: Partial<CanvasElement>) => void
  deleteElement: (id: string) => void
  deleteSelectedElements: () => void
  selectElement: (id: string, multi?: boolean) => void
  clearSelection: () => void
  selectAll: () => void
  duplicateSelected: () => void
  clearBoard: () => void

  /* Collaboration actions */
  setCursors: (cursors: CursorPosition[]) => void
  setActiveUsers: (users: UserSession[]) => void
  addActivityEvent: (event: ActivityEvent) => void
  addChatMessage: (msg: ChatMessage) => void
  updateChatReaction: (messageId: string, emoji: string, sessionId: string, add: boolean) => void
  addLaserPoint: (point: LaserPoint) => void
  pruneLasers: () => void
  addCanvasReaction: (reaction: CanvasReaction) => void
  pruneCanvasReactions: () => void
  setScreenSharer: (sharer: ScreenSharer | null) => void
  setRemoteScreenStream: (stream: MediaStream | null) => void
  setScreenSharePanelWidth: (width: number) => void
  setReactionEmoji: (emoji: string) => void
  setMetrics: (metrics: Partial<BoardMetrics>) => void
  setTypingUser: (sessionId: string, username: string, typing: boolean) => void
  setDrawingUser: (sessionId: string, username: string, drawing: boolean) => void
  setUserMuted: (sessionId: string, muted: boolean) => void

  /* History */
  pushHistory: () => void
  undo: () => void
  redo: () => void
}

export const useBoardStore = create<BoardState>((set, get) => ({
  board: null,
  isLoading: false,
  error: null,
  elements: [],
  selectedElementIds: [],
  activeTool: 'select',
  penMode: 'pen',
  toolColor: '#EF4444',
  toolStrokeWidth: 3,
  showGrid: true,
  snapToGrid: false,
  textFontSize: 18,
  textFontFamily: 'Inter',
  textBold: false,
  textItalic: false,
  textUnderline: false,
  stageScale: 1,
  stagePosition: { x: 0, y: 0 },
  cursors: [],
  activeUsers: [],
  activityFeed: [],
  chatMessages: [],
  metrics: { activeUsers: 0, totalElements: 0, editsPerSecond: 0, sessionDuration: 0 },
  laserPoints: [],
  canvasReactions: [],
  screenSharer: null,
  screenSharePanelWidth: 320,
  remoteScreenStream: null,
  reactionEmoji: '👍',
  typingUsers: {},
  drawingUsers: {},
  history: [],
  historyIndex: -1,

  setBoard: (board) => set({ board }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setPenMode: (penMode) => set({ penMode, activeTool: 'pen' }),
  setToolColor: (toolColor) => set({ toolColor }),
  setToolStrokeWidth: (toolStrokeWidth) => set({ toolStrokeWidth }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setSnapToGrid: (snapToGrid) => set({ snapToGrid }),

  fitToView: (containerWidth, containerHeight) => {
    const { elements } = get()
    if (elements.length === 0) {
      set({ stageScale: 1, stagePosition: { x: 0, y: 0 } })
      return
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const el of elements) {
      if (el.type === 'pen' || el.type === 'line' || el.type === 'arrow') {
        const pts = el.points || []
        for (let i = 0; i < pts.length; i += 2) {
          minX = Math.min(minX, pts[i])
          minY = Math.min(minY, pts[i + 1])
          maxX = Math.max(maxX, pts[i])
          maxY = Math.max(maxY, pts[i + 1])
        }
      } else {
        minX = Math.min(minX, el.x)
        minY = Math.min(minY, el.y)
        maxX = Math.max(maxX, el.x + (el.width || 100))
        maxY = Math.max(maxY, el.y + (el.height || 40))
      }
    }
    const padding = 80
    const contentW = maxX - minX + padding * 2
    const contentH = maxY - minY + padding * 2
    const scale = Math.min(containerWidth / contentW, containerHeight / contentH, 2)
    const clampedScale = Math.max(0.1, Math.min(5, scale))
    set({
      stageScale: clampedScale,
      stagePosition: {
        x: (containerWidth - contentW * clampedScale) / 2 - (minX - padding) * clampedScale,
        y: (containerHeight - contentH * clampedScale) / 2 - (minY - padding) * clampedScale,
      },
    })
  },
  setTextFontSize: (textFontSize) => set({ textFontSize }),
  setTextFontFamily: (textFontFamily) => set({ textFontFamily }),
  setTextBold: (textBold) => set({ textBold }),
  setTextItalic: (textItalic) => set({ textItalic }),
  setTextUnderline: (textUnderline) => set({ textUnderline }),
  setStageScale: (stageScale) => set({ stageScale }),
  setStagePosition: (stagePosition) => set({ stagePosition }),

  setElements: (elements) => set({ elements }),

  addElement: (element) => {
    set((state) => ({ elements: [...state.elements, element] }))
    get().pushHistory()
  },

  updateElement: (id, changes) => {
    set((state) => ({
      elements: state.elements.map((el) =>
        el.id === id ? { ...el, ...changes, updatedAt: new Date().toISOString() } : el
      ),
    }))
  },

  deleteElement: (id) => {
    set((state) => ({
      elements: state.elements.filter((el) => el.id !== id),
      selectedElementIds: state.selectedElementIds.filter((sid) => sid !== id),
    }))
    get().pushHistory()
  },

  deleteSelectedElements: () => {
    const { selectedElementIds } = get()
    set((state) => ({
      elements: state.elements.filter((el) => !selectedElementIds.includes(el.id)),
      selectedElementIds: [],
    }))
    get().pushHistory()
  },

  selectElement: (id, multi = false) => {
    set((state) => {
      if (multi) {
        const exists = state.selectedElementIds.includes(id)
        return {
          selectedElementIds: exists
            ? state.selectedElementIds.filter((sid) => sid !== id)
            : [...state.selectedElementIds, id],
        }
      }
      return { selectedElementIds: [id] }
    })
  },

  clearSelection: () => set({ selectedElementIds: [] }),
  selectAll: () => set((state) => ({ selectedElementIds: state.elements.map((el) => el.id) })),

  duplicateSelected: () => {
    const { selectedElementIds, elements } = get()
    const newElements = elements
      .filter((el) => selectedElementIds.includes(el.id))
      .map((el) => ({
        ...el,
        id: generateId(),
        x: el.x + 20,
        y: el.y + 20,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))
    set((state) => ({
      elements: [...state.elements, ...newElements],
      selectedElementIds: newElements.map((el) => el.id),
    }))
    get().pushHistory()
  },

  clearBoard: () => {
    set({ elements: [], selectedElementIds: [] })
    get().pushHistory()
  },

  setCursors: (cursors) => set({ cursors }),
  setActiveUsers: (activeUsers) => set({ activeUsers }),

  addActivityEvent: (event) => {
    set((state) => ({
      activityFeed: [event, ...state.activityFeed].slice(0, 50),
    }))
  },

  addChatMessage: (msg) => {
    set((state) => ({
      chatMessages: [...state.chatMessages, msg].slice(-100),
    }))
  },

  updateChatReaction: (messageId, emoji, sessionId, add) => {
    set((state) => ({
      chatMessages: state.chatMessages.map((msg) => {
        if (msg.id !== messageId) return msg
        const reactions = [...(msg.reactions || [])]
        const idx = reactions.findIndex((r) => r.emoji === emoji)
        if (idx >= 0) {
          const ids = new Set(reactions[idx].sessionIds)
          if (add) ids.add(sessionId)
          else ids.delete(sessionId)
          if (ids.size === 0) reactions.splice(idx, 1)
          else reactions[idx] = { emoji, sessionIds: [...ids] }
        } else if (add) {
          reactions.push({ emoji, sessionIds: [sessionId] })
        }
        return { ...msg, reactions }
      }),
    }))
  },

  addLaserPoint: (point) => {
    set((state) => ({
      laserPoints: [...state.laserPoints.filter((p) => p.sessionId !== point.sessionId), point],
    }))
  },

  pruneLasers: () => {
    const now = Date.now()
    set((state) => ({
      laserPoints: state.laserPoints.filter((p) => p.expiresAt > now),
    }))
  },

  addCanvasReaction: (reaction) => {
    set((state) => ({
      canvasReactions: [...state.canvasReactions, reaction].slice(-30),
    }))
  },

  pruneCanvasReactions: () => {
    const now = Date.now()
    set((state) => ({
      canvasReactions: state.canvasReactions.filter((r) => r.expiresAt > now),
    }))
  },

  setScreenSharer: (screenSharer) => set({ screenSharer }),
  setRemoteScreenStream: (remoteScreenStream) => set({ remoteScreenStream }),
  setScreenSharePanelWidth: (screenSharePanelWidth) => set({ screenSharePanelWidth }),
  setReactionEmoji: (reactionEmoji) => set({ reactionEmoji }),

  setMetrics: (metrics) => {
    set((state) => ({ metrics: { ...state.metrics, ...metrics } }))
  },

  setTypingUser: (sessionId, username, typing) => set((s) => {
    const next = { ...s.typingUsers }
    if (typing) next[sessionId] = username
    else delete next[sessionId]
    return { typingUsers: next }
  }),

  setDrawingUser: (sessionId, username, drawing) => set((s) => {
    const next = { ...s.drawingUsers }
    if (drawing) next[sessionId] = username
    else delete next[sessionId]
    return { drawingUsers: next }
  }),

  setUserMuted: (sessionId, muted) => set((s) => ({
    activeUsers: s.activeUsers.map((u) =>
      u.sessionId === sessionId ? { ...u, isMuted: muted } : u,
    ),
  })),

  pushHistory: () => {
    const { elements, history, historyIndex } = get()
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push([...elements])
    set({ history: newHistory.slice(-50), historyIndex: newHistory.length - 1 })
  },

  undo: () => {
    const { history, historyIndex } = get()
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      set({ elements: [...history[newIndex]], historyIndex: newIndex })
    }
  },

  redo: () => {
    const { history, historyIndex } = get()
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      set({ elements: [...history[newIndex]], historyIndex: newIndex })
    }
  },
}))
