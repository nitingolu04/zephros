import { io, type Socket } from 'socket.io-client'
import { SocketEvent } from '@/types'
import type { CanvasElement, CursorPosition, ActivityEvent, UserSession, ChatMention } from '@/types'
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
      if (name && k.username.toLowerCase().trim() === name) return true
      return false
    })
    if (!isDupe) kept.push(user)
  }
  return kept
}

const SESSION_STORAGE_KEY = 'aerix_session_id'

function getOrCreateSessionId(): string {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (stored) return stored
    const id = generateId()
    sessionStorage.setItem(SESSION_STORAGE_KEY, id)
    return id
  } catch {
    return generateId()
  }
}

function waitForSocketConnect(socket: Socket, timeoutMs = 8000): Promise<void> {
  if (socket.connected) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timeout')), timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('connect_error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

class SocketService {
  private socket: Socket | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private connectPromise: Promise<void> | null = null
  private boundSocket: Socket | null = null
  private activeBoardId: string | null = null
  private _sessionId: string = getOrCreateSessionId()
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
      auth: token ? { token } : undefined,
    })

    this.bindSocketListeners(this.socket)
    await waitForSocketConnect(this.socket)
  }

  private bindSocketListeners(socket: Socket) {
    if (this.boundSocket === socket) return
    this.boundSocket = socket

    socket.on('connect', () => {
      console.log('[Aerix] Connected to server')
      if (this.activeBoardId) {
        this.emitJoin(this.activeBoardId)
      }
    })

    socket.on('disconnect', () => {
      console.log('[Aerix] Disconnected from server')
      this.stopHeartbeat()
    })

    socket.on('connect_error', (err) => {
      console.warn('[Aerix] Connection error:', err.message)
    })

    socket.on(SocketEvent.BOARD_STATE, (data: { elements: CanvasElement[]; users: UserSession[] }) => {
      const users = dedupeUsers(data.users)
      useBoardStore.getState().setElements(data.elements)
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
      useBoardStore.getState().updateElement(data.elementId, data.changes)
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
      window.location.href = '/'
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

    socket.on(SocketEvent.CHAT_REACTION, (data: { messageId: string; emoji: string; sessionId: string }) => {
      const store = useBoardStore.getState()
      const msg = store.chatMessages.find((m) => m.id === data.messageId)
      const has = msg?.reactions?.find((r) => r.emoji === data.emoji)?.sessionIds.includes(data.sessionId)
      store.updateChatReaction(data.messageId, data.emoji, data.sessionId, !has)
      if (data.sessionId !== this._sessionId) {
        playNotificationSound('chat')
      }
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

    socket.on(SocketEvent.JOIN_ERROR, (data: { message: string }) => {
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
    if (!this.socket?.connected) return
    const pwd = this.boardPassword || sessionStorage.getItem(`aerix_board_pwd_${boardId}`)
    this.socket.emit(SocketEvent.JOIN_BOARD, {
      boardId,
      sessionId: this._sessionId,
      username: this._username,
      color: this._color,
      boardPassword: pwd || undefined,
    })
    this.startHeartbeat(boardId)
  }

  joinBoard(boardId: string, boardPassword?: string): void {
    this.activeBoardId = boardId
    if (boardPassword) {
      this.boardPassword = boardPassword
      sessionStorage.setItem(`aerix_board_pwd_${boardId}`, boardPassword)
    }
    unlockNotificationAudio()
    void this.connect()
      .then(() => this.emitJoin(boardId))
      .catch((err) => console.warn('[Aerix] Socket connect deferred:', err))
  }

  leaveBoard(boardId: string) {
    if (this.activeBoardId === boardId) {
      this.activeBoardId = null
    }
    this.socket?.emit(SocketEvent.LEAVE_BOARD, { boardId, sessionId: this._sessionId })
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
    this.socket?.emit(SocketEvent.ADD_ELEMENT, { boardId, element })
  }

  emitUpdateElement(boardId: string, elementId: string, changes: Partial<CanvasElement>) {
    this.socket?.emit(SocketEvent.UPDATE_ELEMENT, { boardId, elementId, changes })
  }

  emitDeleteElement(boardId: string, elementId: string) {
    this.socket?.emit(SocketEvent.DELETE_ELEMENT, { boardId, elementId })
  }

  emitClearBoard(boardId: string) {
    this.socket?.emit(SocketEvent.CLEAR_BOARD, { boardId })
  }

  emitSyncState(boardId: string, elements: CanvasElement[]) {
    this.socket?.emit('SYNC_STATE', { boardId, elements })
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
