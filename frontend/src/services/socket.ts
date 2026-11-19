import { diffElements, type Patch } from '@/lib/canvasHistory.js'
import { sessionId, sessionToken } from '@/lib/session'
import { io, type Socket } from 'socket.io-client'
import { SocketEvent } from '@/types'
import type { CanvasElement, CursorPosition, ActivityEvent, UserSession, ChatMention, ChatMessage, BoardRole } from '@/types'
import { useBoardStore } from '@/stores/boardStore'
import { generateUsername, generateColor, generateId } from '@/lib/utils'
import { playNotificationSound, unlockNotificationAudio } from '@/lib/notificationSound'

function dedupeUsers(users: UserSession[]): UserSession[] {
  const sorted = [...users].sort(
    (a, b) => new Date(b.lastHeartbeat).getTime() - new Date(a.lastHeartbeat).getTime(),
  )
  const kept: UserSession[] = []
  for (const user of sorted) {
    const name = user.username.toLowerCase().trim()
    const isDupe = kept.some((k) => {
      if (user.userId && k.userId && user.userId === k.userId) return true
      if (user.sessionId === k.sessionId) return true
      return false
    })
    if (!isDupe) kept.push(user)
  }
  return kept
}

type Patches = Patch<CanvasElement>[]

/**
 * The server only applies a patch when its `before` matches the stored element exactly.
 * MongoDB stores `points: []` on every element, while shapes drawn locally have no
 * `points`, so without this undo/restore of a fresh shape was silently ignored.
 */
function toServerPatches(patches: Patches): Patches {
  const normalize = (el: CanvasElement | null) => (el ? { ...el, points: el.points ?? [] } : null)
  return patches.map(p => ({ id: p.id, before: normalize(p.before), after: p.after }))
}

function waitForSocketConnect(socket: Socket, timeoutMs = 8000): Promise<void> {
  if (socket.connected) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); socket.off('connect', connected); socket.off('connect_error', failed) }
    const connected = () => { cleanup(); resolve() }
    const failed = (error: Error) => { cleanup(); reject(error) }
    const timer = setTimeout(() => failed(new Error('Socket connection timeout')), timeoutMs)
    socket.once('connect', connected)
    socket.once('connect_error', failed)
  })
}

class SocketService {
  private socket: Socket | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private connectPromise: Promise<void> | null = null
  private boundSocket: Socket | null = null
  private activeBoardId: string | null = null
  private _sessionId: string = sessionId
  private joinedBoardId: string | null = null
  private joiningBoardId: string | null = null
  private _username: string = generateUsername()
  private _color: string = generateColor()

  get sessionId() { return this._sessionId }
  get username() { return this._username }
  set username(name: string) { this._username = name }
  get color() { return this._color }
  set color(c: string) { this._color = c }

  connect(): Promise<void> {
    if (this.socket?.connected) return Promise.resolve()
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = this.connectWithAuth().finally(() => {
      this.connectPromise = null
    })
    return this.connectPromise
  }

  /** Non-blocking — use from BoardPage so UI never waits on socket */
  ensureConnected(): void {
    void this.connect().catch(() => {})
  }

  private async getAuthToken(): Promise<string | null> {
    try {
      const { useAuthStore } = await import('@/stores/authStore')
      return await useAuthStore.getState().getIdToken()
    } catch {
      return null
    }
  }

  private async connectWithAuth(): Promise<void> {
    if (this.socket?.connected) return

    if (this.socket && !this.socket.disconnected) {
      await waitForSocketConnect(this.socket)
      return
    }

    const socketUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '')
    const token = await this.getAuthToken()

    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.boundSocket = null
    }

    this.socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      auth: (callback) => { void this.getAuthToken().then(token => callback(token ? { token } : {})) },
    })

    this.bindSocketListeners(this.socket)
    await waitForSocketConnect(this.socket)
  }

  private bindSocketListeners(socket: Socket) {
    if (this.boundSocket === socket) return
    this.boundSocket = socket

    socket.on('connect', () => {
      console.log('[Zephros] Connected to server')
      if (this.activeBoardId) {
        this.emitJoin(this.activeBoardId)
      }
    })

    socket.on('disconnect', () => {
      console.log('[Zephros] Disconnected from server')
      this.joinedBoardId = null
      this.joiningBoardId = null
      this.stopHeartbeat()
    })

    socket.on('connect_error', (err) => {
      console.warn('[Zephros] Connection error:', err.message)
    })

    socket.on(SocketEvent.BOARD_STATE, (data: { elements: CanvasElement[]; users: UserSession[]; boardId: string; chat?: ChatMessage[]; role?: BoardRole; linkAccess?: 'edit' | 'view' }) => {
      if (data.boardId !== this.activeBoardId) return
      this.joinedBoardId = data.boardId
      this.joiningBoardId = null
      this.startHeartbeat(data.boardId)
      const users = dedupeUsers(data.users)
      useBoardStore.getState().setElements(data.elements)
      useBoardStore.getState().setMyRole(data.role || 'editor')
      const joined = useBoardStore.getState().board
      if (joined && data.linkAccess) useBoardStore.getState().setBoard({ ...joined, linkAccess: data.linkAccess })
      // Backends that store chat send its history; older ones don't, and the device cache is kept.
      if (Array.isArray(data.chat)) useBoardStore.getState().setChatMessages(data.chat)
      useBoardStore.getState().setActiveUsers(users)
      useBoardStore.getState().setMetrics({ activeUsers: users.length, totalElements: data.elements.length })
    })

    socket.on(SocketEvent.ADD_ELEMENT, (element: CanvasElement) => {
      const store = useBoardStore.getState()
      const exists = store.elements.find((el) => el.id === element.id)
      if (!exists) {
        store.setElements([...store.elements, element])
        store.setMetrics({ totalElements: store.elements.length + 1 })
      }
    })

    socket.on(SocketEvent.UPDATE_ELEMENT, (data: { elementId: string; changes: Partial<CanvasElement> }) => {
      const store = useBoardStore.getState()
      store.setElements(store.elements.map(el => el.id === data.elementId ? { ...el, ...data.changes } : el))
    })

    socket.on(SocketEvent.DELETE_ELEMENT, (data: { elementId: string }) => {
      const store = useBoardStore.getState()
      store.setElements(store.elements.filter((el) => el.id !== data.elementId))
    })

    socket.on(SocketEvent.CLEAR_BOARD, () => {
      useBoardStore.getState().setElements([])
    })

    socket.on('SYNC_STATE', (data: { elements: CanvasElement[] }) => {
      useBoardStore.getState().setElements(data.elements)
      useBoardStore.getState().setMetrics({ totalElements: data.elements.length })
    })

    socket.on(SocketEvent.CURSORS_UPDATE, (cursors: CursorPosition[]) => {
      useBoardStore.getState().setCursors(cursors.filter((c) => c.sessionId !== this._sessionId))
    })

    socket.on(SocketEvent.PRESENCE_UPDATE, (users: UserSession[]) => {
      const unique = dedupeUsers(users)
      useBoardStore.getState().setActiveUsers(unique)
      useBoardStore.getState().setMetrics({ activeUsers: unique.length })
    })

    socket.on(SocketEvent.ACTIVITY_EVENT, (event: ActivityEvent) => {
      useBoardStore.getState().addActivityEvent(event)
    })

    socket.on(SocketEvent.USER_JOINED, (data: { username: string; color: string }) => {
      useBoardStore.getState().addActivityEvent({
        id: generateId(),
        message: `${data.username} joined the board`,
        username: data.username,
        color: data.color,
        timestamp: new Date().toISOString(),
        type: 'join',
      })
      playNotificationSound('join')
      void import('sonner').then(({ toast }) => {
        toast.info(`${data.username} joined the board`)
      })
    })

    socket.on(SocketEvent.USER_LEFT, (data: { username: string; color: string }) => {
      useBoardStore.getState().addActivityEvent({
        id: generateId(),
        message: `${data.username} left the board`,
        username: data.username,
        color: data.color,
        timestamp: new Date().toISOString(),
        type: 'leave',
      })
      playNotificationSound('leave')
      void import('sonner').then(({ toast }) => {
        toast.info(`${data.username} left the board`)
      })
    })

    socket.on(SocketEvent.BOARD_DELETED, () => {
      void import('sonner').then(({ toast }) => toast.error('This board was deleted by its owner'))
      setTimeout(() => { window.location.href = '/' }, 1500)
    })

    // The host gave me edit access or made me a viewer (or changed the board link setting).
    socket.on('ROLE_UPDATED', (data: { role: BoardRole; by?: string }) => {
      const before = useBoardStore.getState().myRole
      useBoardStore.getState().setMyRole(data.role)
      if (before === data.role) return
      void import('sonner').then(({ toast }) => {
        if (data.role === 'viewer') toast.info('You can now only view this board', { description: 'The host turned off editing for you. You can still chat and join the call.' })
        else toast.success('You can now edit this board')
      })
    })

    // Title / saved / lock changes made in another tab or by the owner.
    socket.on(SocketEvent.BOARD_UPDATED, (changes: Partial<{ title: string; persistent: boolean; requireAuth: boolean; isLocked: boolean; hasPassword: boolean; linkAccess: 'edit' | 'view' }>) => {
      const { board, setBoard } = useBoardStore.getState()
      if (board) setBoard({ ...board, ...changes })
    })

    socket.on('CHAT_MESSAGE', (msg: {
      id: string; message: string; username: string; color: string
      sessionId: string; timestamp: string; mentions?: ChatMention[]; reactions?: { emoji: string; sessionIds: string[] }[]
    }) => {
      useBoardStore.getState().addChatMessage(msg)
      if (msg.sessionId !== this._sessionId) {
        playNotificationSound('chat')
      }
    })

    socket.on(SocketEvent.CHAT_REACTION, (data: { messageId: string; emoji: string; sessionId: string; reactions?: { emoji: string; sessionIds: string[] }[] }) => {
      const store = useBoardStore.getState()
      if (Array.isArray(data.reactions)) {
        // The server's list is authoritative, so the sender's optimistic toggle can't be applied twice.
        store.setChatReactions(data.messageId, data.reactions)
      } else {
        const msg = store.chatMessages.find((m) => m.id === data.messageId)
        const has = msg?.reactions?.find((r) => r.emoji === data.emoji)?.sessionIds.includes(data.sessionId)
        store.updateChatReaction(data.messageId, data.emoji, data.sessionId, !has)
      }
      if (data.sessionId !== this._sessionId) {
        playNotificationSound('chat')
      }
    })

    socket.on('CHAT_CLEARED', (data: { by?: string }) => {
      useBoardStore.getState().clearChat()
      void import('sonner').then(({ toast }) => toast.info(`${data.by || 'Someone'} cleared the chat`, { id: 'chat-cleared' }))
    })

    socket.on(SocketEvent.LASER_POINTER, (data: { sessionId: string; username: string; color: string; x: number; y: number }) => {
      useBoardStore.getState().addLaserPoint({
        ...data,
        expiresAt: Date.now() + 2000,
      })
    })

    socket.on(SocketEvent.CANVAS_REACTION, (data: { id: string; sessionId: string; username: string; x: number; y: number; emoji: string }) => {
      useBoardStore.getState().addCanvasReaction({
        ...data,
        expiresAt: Date.now() + 3000,
      })
    })

    socket.on(SocketEvent.MENTION_NOTIFY, (data: { message: string; from: string }) => {
      void import('sonner').then(({ toast }) => {
        toast.info(`${data.from} mentioned you: ${data.message.slice(0, 60)}`)
      })
    })

    socket.on(SocketEvent.SCREEN_SHARE_START, (data: { sessionId: string; username: string }) => {
      useBoardStore.getState().setScreenSharer(data)
      if (data.sessionId !== this._sessionId) {
        void import('sonner').then(({ toast }) => {
          toast.info(`${data.username} started sharing their screen`)
        })
      }
    })

    socket.on(SocketEvent.SCREEN_SHARE_STOP, (data?: { sessionId?: string }) => {
      const sharer = useBoardStore.getState().screenSharer
      useBoardStore.getState().setScreenSharer(null)
      const stoppedBy = data?.sessionId
      if (stoppedBy && stoppedBy !== this._sessionId) {
        const name = sharer?.sessionId === stoppedBy ? sharer.username : 'Presenter'
        void import('sonner').then(({ toast }) => {
          toast.info(`${name} stopped sharing their screen`)
        })
      } else if (!stoppedBy && sharer && sharer.sessionId !== this._sessionId) {
        void import('sonner').then(({ toast }) => {
          toast.info(`${sharer.username} stopped sharing their screen`)
        })
      }
    })

    socket.on(SocketEvent.CHAT_TYPING, (data: { sessionId: string; username: string; typing: boolean }) => {
      if (data.sessionId === this._sessionId) return
      useBoardStore.getState().setTypingUser(data.sessionId, data.username, data.typing)
    })

    socket.on(SocketEvent.USER_DRAWING, (data: { sessionId: string; username: string; drawing: boolean }) => {
      if (data.sessionId === this._sessionId) return
      useBoardStore.getState().setDrawingUser(data.sessionId, data.username, data.drawing)
    })

    socket.on(SocketEvent.USER_MUTED, (data: { sessionId: string; muted: boolean }) => {
      useBoardStore.getState().setUserMuted(data.sessionId, data.muted)
    })

    socket.on(SocketEvent.KICKED_FROM_BOARD, (data: { message?: string }) => {
      void import('sonner').then(({ toast }) => {
        toast.error(data.message || 'You were removed from the board')
      })
      if (this.activeBoardId) {
        this.leaveBoard(this.activeBoardId)
      }
      window.location.href = '/'
    })

    socket.on('OPERATION_ERROR', (data: { message: string }) => {
      void import('sonner').then(({ toast }) => toast.error(data.message || 'Change could not be saved'))
      if (this.activeBoardId) { this.joiningBoardId = null; this.emitJoin(this.activeBoardId) }
    })
    socket.on(SocketEvent.JOIN_ERROR, (data: { message: string }) => {
      this.joiningBoardId = null
      this.joinedBoardId = null
      this.stopHeartbeat()
      void import('sonner').then(({ toast }) => {
        toast.error(data.message || 'Could not join board')
      })
    })
  }

  private boardPassword: string | null = null

  setBoardPassword(password: string | null) {
    this.boardPassword = password
  }

  private emitJoin(boardId: string) {
    if (!this.socket?.connected || this.joiningBoardId === boardId) return
    this.joiningBoardId = boardId
    const pwd = this.boardPassword || sessionStorage.getItem(`zephros_board_pwd_${boardId}`)
    this.socket.emit(SocketEvent.JOIN_BOARD, {
      boardId,
      sessionId: this._sessionId,
      sessionToken,
      username: this._username,
      color: this._color,
      boardPassword: pwd || undefined,
      editLink: sessionStorage.getItem(`zephros_edit_link_${boardId}`) || undefined,
    })
  }

  joinBoard(boardId: string, boardPassword?: string): void {
    if (this.activeBoardId !== boardId) { this.boardPassword = null; this.joinedBoardId = null; this.joiningBoardId = null }
    this.activeBoardId = boardId
    if (boardPassword) {
      this.boardPassword = boardPassword
      sessionStorage.setItem(`zephros_board_pwd_${boardId}`, boardPassword)
    }
    unlockNotificationAudio()
    void this.connect()
      .then(() => { if (this.activeBoardId === boardId && this.joinedBoardId !== boardId) this.emitJoin(boardId) })
      .catch((err) => console.warn('[Zephros] Socket connect deferred:', err))
  }

  leaveBoard(boardId: string) {
    if (this.activeBoardId === boardId) {
      this.activeBoardId = null
      this.joinedBoardId = null
      this.joiningBoardId = null
      this.boardPassword = null
    }
    if (this.socket?.connected) this.socket.emit(SocketEvent.LEAVE_BOARD, { boardId, sessionId: this._sessionId })
    this.stopHeartbeat()
  }

  emitCursorMove(boardId: string, x: number, y: number) {
    this.socket?.volatile.emit(SocketEvent.CURSOR_MOVE, {
      boardId,
      sessionId: this._sessionId,
      username: this._username,
      color: this._color,
      x,
      y,
    })
  }

  emitAddElement(boardId: string, element: CanvasElement) {
    if (boardId === 'preview-local' || !this.canEdit(boardId)) return
    this.socket?.emit(SocketEvent.ADD_ELEMENT, { boardId, element })
  }

  emitUpdateElement(boardId: string, elementId: string, changes: Partial<CanvasElement>) {
    if (boardId === 'preview-local' || !this.canEdit(boardId)) return
    this.socket?.emit(SocketEvent.UPDATE_ELEMENT, { boardId, elementId, changes })
  }

  emitDeleteElement(boardId: string, elementId: string) {
    if (boardId === 'preview-local' || !this.canEdit(boardId)) return
    this.socket?.emit(SocketEvent.DELETE_ELEMENT, { boardId, elementId })
  }

  emitClearBoard(boardId: string) {
    if (boardId === 'preview-local' || !this.canEdit(boardId)) return
    this.socket?.emit(SocketEvent.CLEAR_BOARD, { boardId })
  }

  applyHistory(direction: 'undo' | 'redo') {
    const store = useBoardStore.getState()
    const boardId = store.board?.roomId
    if (!boardId || !this.canEdit(boardId)) return
    const before = store.elements
    store[direction]()
    const patches = diffElements(before, useBoardStore.getState().elements)
    if (patches.length && boardId !== 'preview-local') this.socket?.emit('SYNC_STATE', { boardId, patches: toServerPatches(patches) })
  }

  /**
   * Send arbitrary element patches (used by version restore) through the same
   * SYNC_STATE event undo/redo already uses. The server caps each message at 500.
   */
  emitPatches(boardId: string, patches: Patches) {
    if (!patches.length || boardId === 'preview-local' || !this.canEdit(boardId)) return
    const serverPatches = toServerPatches(patches)
    for (let i = 0; i < serverPatches.length; i += 500) {
      this.socket?.emit('SYNC_STATE', { boardId, patches: serverPatches.slice(i, i + 500) })
    }
  }

  canEdit(boardId: string): boolean {
    if (boardId === 'preview-local') return true
    if (useBoardStore.getState().myRole === 'viewer') {
      void import('sonner').then(({ toast }) => toast.info('You have view-only access. Ask the host for edit access.', { id: 'view-only' }))
      return false
    }
    if (this.socket?.connected && this.joinedBoardId === boardId) return true
    void import('sonner').then(({ toast }) => toast.info('Waiting for the board connection. Please retry when connected.', { id: 'board-connection' }))
    return false
  }

  emitSetRole(boardId: string, targetSessionId: string, role: BoardRole) {
    this.socket?.emit('SET_ROLE', { boardId, targetSessionId, role })
  }

  emitActivityEvent(boardId: string, event: ActivityEvent) {
    this.socket?.emit(SocketEvent.ACTIVITY_EVENT, { boardId, event })
  }

  emitUpdateUsername(boardId: string, newUsername: string) {
    this.socket?.emit('UPDATE_USERNAME', {
      boardId,
      sessionId: this._sessionId,
      username: newUsername,
    })
  }

  emitChatMessage(boardId: string, message: string, mentions?: ChatMention[]) {
    this.socket?.emit('CHAT_MESSAGE', { boardId, message, mentions: mentions || [] })
  }

  emitClearChat(boardId: string) {
    this.socket?.emit('CHAT_CLEAR', { boardId })
  }

  emitChatReaction(boardId: string, messageId: string, emoji: string) {
    this.socket?.emit('CHAT_REACTION', { boardId, messageId, emoji })
  }

  emitLaserPointer(boardId: string, x: number, y: number) {
    this.socket?.volatile.emit(SocketEvent.LASER_POINTER, { boardId, x, y })
  }

  emitCanvasReaction(boardId: string, x: number, y: number, emoji: string) {
    this.socket?.emit(SocketEvent.CANVAS_REACTION, { boardId, x, y, emoji })
  }

  emitScreenShareStart(boardId: string) {
    this.socket?.emit(SocketEvent.SCREEN_SHARE_START, { boardId, sessionId: this._sessionId })
  }

  emitScreenShareStop(boardId: string) {
    this.socket?.emit(SocketEvent.SCREEN_SHARE_STOP, { boardId, sessionId: this._sessionId })
  }

  emitScreenShareRequestOffer(boardId: string) {
    this.socket?.emit('SCREEN_SHARE_REQUEST_OFFER', { boardId, sessionId: this._sessionId })
  }

  emitScreenShareOffer(boardId: string, offer: RTCSessionDescriptionInit, targetSessionId?: string) {
    this.socket?.emit(SocketEvent.SCREEN_SHARE_OFFER, {
      boardId, sessionId: this._sessionId, offer, targetSessionId,
    })
  }

  emitScreenShareAnswer(boardId: string, targetSessionId: string, answer: RTCSessionDescriptionInit) {
    this.socket?.emit(SocketEvent.SCREEN_SHARE_ANSWER, {
      boardId, sessionId: this._sessionId, targetSessionId, answer,
    })
  }

  emitScreenShareIce(boardId: string, targetSessionId: string, candidate: RTCIceCandidate) {
    this.socket?.emit(SocketEvent.SCREEN_SHARE_ICE, {
      boardId, sessionId: this._sessionId, targetSessionId, candidate,
    })
  }

  private startHeartbeat(boardId: string) {
    this.stopHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      this.socket?.emit(SocketEvent.HEARTBEAT, { boardId, sessionId: this._sessionId })
    }, 10000)
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  disconnect() {
    this.stopHeartbeat()
    this.activeBoardId = null
    this.joinedBoardId = null
    this.joiningBoardId = null
    this.socket?.removeAllListeners()
    this.socket?.disconnect()
    this.socket = null
    this.boundSocket = null
  }

  get isConnected() {
    return this.socket?.connected ?? false
  }

  getSocket() {
    return this.socket
  }

  emitCallJoin(boardId: string, data: {
    sessionId: string
    username: string
    color: string
    audioEnabled: boolean
    videoEnabled: boolean
  }) {
    this.socket?.emit('CALL_JOIN', { boardId, ...data })
  }

  emitCallLeave(boardId: string, sessionId: string) {
    this.socket?.emit('CALL_LEAVE', { boardId, sessionId })
  }

  emitMediaState(boardId: string, data: { sessionId: string; audioEnabled: boolean; videoEnabled: boolean }) {
    this.socket?.emit('MEDIA_STATE', { boardId, ...data })
  }

  emitWebRTCOffer(boardId: string, targetSessionId: string, offer: RTCSessionDescriptionInit) {
    this.socket?.emit('WEBRTC_OFFER', {
      boardId,
      sessionId: this._sessionId,
      targetSessionId,
      offer,
    })
  }

  emitWebRTCAnswer(boardId: string, targetSessionId: string, answer: RTCSessionDescriptionInit) {
    this.socket?.emit('WEBRTC_ANSWER', {
      boardId,
      sessionId: this._sessionId,
      targetSessionId,
      answer,
    })
  }

  emitIceCandidate(boardId: string, targetSessionId: string, candidate: RTCIceCandidate) {
    this.socket?.emit('ICE_CANDIDATE', {
      boardId,
      sessionId: this._sessionId,
      targetSessionId,
      candidate,
    })
  }

  emitChatTyping(boardId: string, typing: boolean) {
    this.socket?.volatile.emit(SocketEvent.CHAT_TYPING, { boardId, typing })
  }

  emitUserDrawing(boardId: string, drawing: boolean) {
    this.socket?.volatile.emit(SocketEvent.USER_DRAWING, { boardId, drawing })
  }

  emitKickUser(boardId: string, targetSessionId: string) {
    this.socket?.emit('KICK_USER', { boardId, targetSessionId })
  }

  emitMuteUser(boardId: string, targetSessionId: string) {
    this.socket?.emit('MUTE_USER', { boardId, targetSessionId })
  }
}

export const socketService = new SocketService()
