import crypto from 'crypto'
import { Board, Session } from '../models/index.js'

const SALT = process.env.BOARD_PASSWORD_SALT || 'aerix-board-salt'

export function hashBoardPassword(password) {
  return crypto.createHash('sha256').update(`${SALT}:${password}`).digest('hex')
}

export function boardAccessMeta(board) {
  const obj = board.toObject ? board.toObject() : { ...board }
  delete obj.accessPasswordHash
  return {
    ...obj,
    hasPassword: Boolean(board.accessPasswordHash),
  }
}

export async function canAccessBoard(board, { userId, password, sessionId } = {}) {
  if (!board) return { allowed: false, reason: 'not_found' }

  const isOwner = userId && board.ownerUid && board.ownerUid === userId

  if (board.isLocked && !isOwner) {
    let hasExistingSession = false
    if (sessionId) {
      const existing = await Session.findOne({ boardId: board.roomId, sessionId }).lean()
      hasExistingSession = Boolean(existing)
    }
    if (!hasExistingSession) {
      return { allowed: false, reason: 'locked' }
    }
  }

  if (board.requireAuth && !userId) return { allowed: false, reason: 'auth' }
  if (board.accessPasswordHash) {
    if (!isOwner) {
      if (!password || hashBoardPassword(password) !== board.accessPasswordHash) {
        return { allowed: false, reason: 'password' }
      }
    }
  }
  return { allowed: true }
}

export async function isBoardOwner(boardId, userId) {
  if (!userId) return false
  const board = await Board.findOne({ roomId: boardId }).lean()
  return Boolean(board?.ownerUid && board.ownerUid === userId)
}
