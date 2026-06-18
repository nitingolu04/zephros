/* ── Board Types ── */

export interface Board {

  _id: string

  title: string

  roomId: string

  persistent?: boolean

  ownerUid?: string | null

  requireAuth?: boolean

  isLocked?: boolean

  hasPassword?: boolean

  lastEditedBy?: { uid: string | null; displayName: string | null } | null

  createdAt: string

  updatedAt: string

}



export interface BoardHistoryItem {

  id: string

  title: string

  lastVisited: string

  exists: boolean

  persistent: boolean

  isOwner: boolean

  updatedAt: string | null

  lastEditedBy: { uid: string | null; displayName: string | null } | null

  activeSessions: number

}



export interface ChatMention {

  sessionId: string

  username: string

}



export interface ChatReaction {

  emoji: string

  sessionIds: string[]

}



export interface ChatMessage {

  id: string

  message: string

  username: string

  color: string

  sessionId: string

  timestamp: string

  mentions?: ChatMention[]

  reactions?: ChatReaction[]

}



export interface LaserPoint {

  sessionId: string

  username: string

  color: string

  x: number

  y: number

  expiresAt: number

}



export interface CanvasReaction {

  id: string

  sessionId: string

  username: string

  x: number

  y: number

  emoji: string

  expiresAt: number

}



export interface ScreenSharer {

  sessionId: string

  username: string

}



/* ── Element Types ── */

export type ElementType = 'rectangle' | 'circle' | 'line' | 'arrow' | 'text' | 'sticky' | 'pen' | 'image' | 'frame'



export interface CanvasElement {

  id: string

  boardId: string

  type: ElementType

  x: number

  y: number

  width?: number

  height?: number

  rotation?: number

  fill?: string

  stroke?: string

  strokeWidth?: number

  text?: string

  fontSize?: number

  fontFamily?: string

  fontStyle?: string

  textDecoration?: string

  points?: number[]

  opacity?: number

  cornerRadius?: number

  draggable: boolean

  createdAt: string

  updatedAt: string

  createdBy?: string

  imageSrc?: string

}



/* ── Session / User Types ── */

export interface UserSession {

  sessionId: string

  boardId: string

  userId?: string | null

  username: string

  color: string

  lastHeartbeat: string

  isMuted?: boolean

}



export interface CursorPosition {

  sessionId: string

  username: string

  color: string

  x: number

  y: number

}



/* ── Activity Feed ── */

export interface ActivityEvent {

  id: string

  message: string

  username: string

  color: string

  timestamp: string

  type: 'add' | 'update' | 'delete' | 'join' | 'leave' | 'clear' | 'rename'

}



/* ── Tool Types ── */

export type ToolType = 'select' | 'pen' | 'rectangle' | 'circle' | 'line' | 'arrow' | 'text' | 'sticky' | 'eraser' | 'laser' | 'reaction' | 'frame'



/* ── Theme ── */

export type ThemeMode = 'light' | 'dark' | 'system'



/* ── Metrics ── */

export interface BoardMetrics {

  activeUsers: number

  totalElements: number

  editsPerSecond: number

  sessionDuration: number

}



/* ── Socket Events ── */

export const SocketEvent = {

  JOIN_BOARD: 'JOIN_BOARD',

  LEAVE_BOARD: 'LEAVE_BOARD',

  CURSOR_MOVE: 'CURSOR_MOVE',

  ADD_ELEMENT: 'ADD_ELEMENT',

  UPDATE_ELEMENT: 'UPDATE_ELEMENT',

  DELETE_ELEMENT: 'DELETE_ELEMENT',

  CLEAR_BOARD: 'CLEAR_BOARD',

  ACTIVITY_EVENT: 'ACTIVITY_EVENT',

  HEARTBEAT: 'HEARTBEAT',

  USER_JOINED: 'USER_JOINED',

  USER_LEFT: 'USER_LEFT',

  BOARD_STATE: 'BOARD_STATE',

  BOARD_DELETED: 'BOARD_DELETED',

  CURSORS_UPDATE: 'CURSORS_UPDATE',

  PRESENCE_UPDATE: 'PRESENCE_UPDATE',

  LASER_POINTER: 'LASER_POINTER',

  CANVAS_REACTION: 'CANVAS_REACTION',

  CHAT_REACTION: 'CHAT_REACTION',

  MENTION_NOTIFY: 'MENTION_NOTIFY',

  SCREEN_SHARE_START: 'SCREEN_SHARE_START',

  SCREEN_SHARE_STOP: 'SCREEN_SHARE_STOP',

  SCREEN_SHARE_OFFER: 'SCREEN_SHARE_OFFER',

  SCREEN_SHARE_ANSWER: 'SCREEN_SHARE_ANSWER',

  SCREEN_SHARE_ICE: 'SCREEN_SHARE_ICE',

  CHAT_TYPING: 'CHAT_TYPING',

  USER_DRAWING: 'USER_DRAWING',

  KICKED_FROM_BOARD: 'KICKED_FROM_BOARD',

  FORCE_MUTE: 'FORCE_MUTE',

  USER_MUTED: 'USER_MUTED',

  JOIN_ERROR: 'JOIN_ERROR',

} as const



/* ── Media / Call Types ── */

export interface MediaParticipant {

  sessionId: string

  username: string

  color: string

  audioEnabled: boolean

  videoEnabled: boolean

  isLocal?: boolean

}



export const MediaEvent = {

  CALL_JOIN: 'CALL_JOIN',

  CALL_LEAVE: 'CALL_LEAVE',

  CALL_PARTICIPANTS: 'CALL_PARTICIPANTS',

  USER_CALL_JOINED: 'USER_CALL_JOINED',

  USER_CALL_LEFT: 'USER_CALL_LEFT',

  MEDIA_STATE: 'MEDIA_STATE',

  WEBRTC_OFFER: 'WEBRTC_OFFER',

  WEBRTC_ANSWER: 'WEBRTC_ANSWER',

  ICE_CANDIDATE: 'ICE_CANDIDATE',

} as const



/* ── API Response ── */

export interface ApiResponse<T = unknown> {

  success: boolean

  data?: T

  error?: string

}



export interface CreateBoardResponse {

  boardId: string

  roomId: string

  shareUrl: string

  board?: Board
}

