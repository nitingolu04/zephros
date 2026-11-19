import { applyPatches, diffElements, type Patch } from '@/lib/canvasHistory.js'
import { create } from 'zustand'
import type {
  Board,
  CanvasElement,
  ToolType,
  PenMode,
  ShapeToolType,
  CursorPosition,
  ActivityEvent,
  UserSession,
  BoardMetrics,
  ChatMessage,
  LaserPoint,
  CanvasReaction,
  ScreenSharer,
  ChatMention,
  BoardRole,
} from '@/types'
import { generateId } from '@/lib/utils'

/* ── Device-local preferences and chat history (frontend only, no backend involvement) ── */
const SMART_SHAPES_KEY = 'zephros-smart-shapes'
const CHAT_KEY = (boardId: string) => `zephros-chat:${boardId}`
const CHAT_LIMIT = 200

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage full or blocked: ignore */ }
}

function loadChat(boardId: string | undefined): ChatMessage[] {
  if (!boardId) return []
  const saved = readLocal<ChatMessage[]>(CHAT_KEY(boardId), [])
  return Array.isArray(saved) ? saved.slice(-CHAT_LIMIT) : []
}

function saveChat(boardId: string | undefined, messages: ChatMessage[]) {
  if (boardId && boardId !== 'preview-local') writeLocal(CHAT_KEY(boardId), messages.slice(-CHAT_LIMIT))
}

export function clearSavedChat(boardId: string) {
  try { localStorage.removeItem(CHAT_KEY(boardId)) } catch { /* ignore */ }
}

/** Tools a viewer may use: they only move around, point and react, never change the board. */
export const VIEWER_TOOLS: ToolType[] = ['hand', 'laser', 'reaction']

interface BoardState {
  /* Board */
  board: Board | null
  /** My permission on this board, decided by the server. */
  myRole: BoardRole
  isLoading: boolean
  error: string | null

  /* Elements */
  elements: CanvasElement[]
  selectedElementIds: string[]

  /* Tool */
  activeTool: ToolType
  penMode: PenMode
  lastShapeTool: ShapeToolType
  shapeFillEnabled: boolean
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
  history: Patch<CanvasElement>[][]
  historyIndex: number

  /* Frontend-only features */
  smartShapes: boolean
  showVersionHistory: boolean
  /** True once the backend has sent chat history (it stores chat); otherwise chat is cached on this device. */
  serverChat: boolean

  /* Actions */
  setBoard: (board: Board | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setActiveTool: (tool: ToolType) => void
  setMyRole: (role: BoardRole) => void
  setPenMode: (mode: PenMode) => void
  setLastShapeTool: (shape: ShapeToolType) => void
  setShapeFillEnabled: (enabled: boolean) => void
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

  /* Frontend-only features */
  setSmartShapes: (enabled: boolean) => void
  setShowVersionHistory: (open: boolean) => void
  /** Replace the whole canvas (used by version restore); undoable like any edit. */
  replaceElements: (elements: CanvasElement[]) => void
  clearChat: () => void
  /** Replace chat with the server's history (BOARD_STATE). */
  setChatMessages: (messages: ChatMessage[]) => void
  /** Apply the server's authoritative reaction list for one message. */
  setChatReactions: (messageId: string, reactions: { emoji: string; sessionIds: string[] }[]) => void

  /* History */
  pushHistory: (before: CanvasElement[]) => void
  undo: () => void
  redo: () => void
}

export const useBoardStore = create<BoardState>((set, get) => ({
  board: null,
  myRole: 'editor',
  isLoading: false,
  error: null,
  elements: [],
  selectedElementIds: [],
  activeTool: 'select',
  penMode: 'pen',
  lastShapeTool: 'rectangle',
  shapeFillEnabled: true,
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
  smartShapes: readLocal(SMART_SHAPES_KEY, true),
  showVersionHistory: false,
  serverChat: false,

  setBoard: (board) => {
    if (board?.roomId !== get().board?.roomId) {
      set({ board, elements: [], selectedElementIds: [], history: [], historyIndex: -1,
        activityFeed: [], chatMessages: loadChat(board?.roomId), cursors: [], activeUsers: [], typingUsers: {}, drawingUsers: {},
        screenSharer: null, remoteScreenStream: null, laserPoints: [], canvasReactions: [],
        stageScale: 1, stagePosition: { x: 0, y: 0 }, error: null, showVersionHistory: false, serverChat: false, myRole: 'editor' })
    } else set({ board })
  },
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setActiveTool: (activeTool) => {
    if (get().myRole === 'viewer' && !VIEWER_TOOLS.includes(activeTool)) return
    const shapes: ShapeToolType[] = ['rectangle', 'circle', 'line', 'arrow']
    if (shapes.includes(activeTool as ShapeToolType)) {
      set({ activeTool, lastShapeTool: activeTool as ShapeToolType })
    } else {
      set({ activeTool })
    }
  },
  setMyRole: (myRole) => {
    if (myRole === 'viewer' && !VIEWER_TOOLS.includes(get().activeTool)) set({ myRole, activeTool: 'hand', selectedElementIds: [] })
    else set({ myRole })
  },
  setPenMode: (penMode) => set(get().myRole === 'viewer' ? { penMode } : { penMode, activeTool: 'pen' }),
  setLastShapeTool: (lastShapeTool) => set(get().myRole === 'viewer' ? { lastShapeTool } : { lastShapeTool, activeTool: lastShapeTool }),
  setShapeFillEnabled: (shapeFillEnabled) => set({ shapeFillEnabled }),
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
    const before = get().elements
    set((state) => ({ elements: [...state.elements, element] }))
    get().pushHistory(before)
  },

  updateElement: (id, changes) => {
    const before = get().elements
    set((state) => ({
      elements: state.elements.map((el) =>
        el.id === id ? { ...el, ...changes, updatedAt: new Date().toISOString() } : el
      ),
    }))
    get().pushHistory(before)
  },

  deleteElement: (id) => {
    const before = get().elements
    set((state) => ({
      elements: state.elements.filter((el) => el.id !== id),
      selectedElementIds: state.selectedElementIds.filter((sid) => sid !== id),
    }))
    get().pushHistory(before)
  },

  deleteSelectedElements: () => {
    const before = get().elements
    const { selectedElementIds } = get()
    set((state) => ({
      elements: state.elements.filter((el) => !selectedElementIds.includes(el.id)),
      selectedElementIds: [],
    }))
    get().pushHistory(before)
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
    const before = get().elements
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
    get().pushHistory(before)
  },

  clearBoard: () => {
    const before = get().elements
    set({ elements: [], selectedElementIds: [] })
    get().pushHistory(before)
  },

  setCursors: (cursors) => set({ cursors }),
  setActiveUsers: (activeUsers) => set({ activeUsers }),

  addActivityEvent: (event) => {
    set((state) => ({
      activityFeed: [event, ...state.activityFeed].slice(0, 50),
    }))
  },

  addChatMessage: (msg) => {
    if (get().chatMessages.some((m) => m.id === msg.id)) return
    set((state) => ({
      chatMessages: [...state.chatMessages, msg].slice(-CHAT_LIMIT),
    }))
    saveChat(get().board?.roomId, get().chatMessages)
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
    saveChat(get().board?.roomId, get().chatMessages)
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

  setSmartShapes: (smartShapes) => {
    writeLocal(SMART_SHAPES_KEY, smartShapes)
    set({ smartShapes })
  },
  setShowVersionHistory: (showVersionHistory) => set({ showVersionHistory }),
  replaceElements: (elements) => {
    const before = get().elements
    set({ elements, selectedElementIds: [] })
    get().pushHistory(before)
  },
  setChatMessages: (chatMessages) => {
    set({ chatMessages: chatMessages.slice(-CHAT_LIMIT), serverChat: true })
    saveChat(get().board?.roomId, get().chatMessages)
  },
  setChatReactions: (messageId, reactions) => {
    set((state) => ({ chatMessages: state.chatMessages.map((m) => (m.id === messageId ? { ...m, reactions } : m)) }))
    saveChat(get().board?.roomId, get().chatMessages)
  },
  clearChat: () => {
    const boardId = get().board?.roomId
    if (boardId) clearSavedChat(boardId)
    set({ chatMessages: [] })
  },

  pushHistory: (before) => {
    const patches = diffElements(before, get().elements)
    if (!patches.length) return
    const history = [...get().history.slice(0, get().historyIndex + 1), patches].slice(-50)
    set({ history, historyIndex: history.length - 1 })
  },

  undo: () => {
    const { history, historyIndex, elements } = get()
    if (historyIndex < 0) return
    const inverse = history[historyIndex].map(p => ({ id: p.id, before: p.after, after: p.before }))
    set({ elements: applyPatches(elements, inverse), historyIndex: historyIndex - 1, selectedElementIds: [] })
  },

  redo: () => {
    const { history, historyIndex, elements } = get()
    if (historyIndex >= history.length - 1) return
    set({ elements: applyPatches(elements, history[historyIndex + 1]), historyIndex: historyIndex + 1, selectedElementIds: [] })
  },
}))
