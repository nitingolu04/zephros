import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { Board, Session } from '../models/index.js'
import { passwordAttempts } from './rateLimit.js'

// Async scrypt runs on the libuv thread pool, so password checks never block the event loop.
const scrypt = promisify(crypto.scrypt)
const RESUME_WINDOW_MS = 120000

export async function hashBoardPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 32)
  return `scrypt:${salt}:${key.toString('hex')}`
}

export async function verifyBoardPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 256 || typeof hash !== 'string') return false
  const [format, salt, stored] = hash.split(':')
  let actual, expected
  if (format === 'scrypt') {
    if (!salt || !stored) return false
    actual = (await scrypt(password, salt, 32)).toString('hex')
    expected = stored
  } else {
    // Legacy unsalted SHA-256 hashes from earlier versions. The old default salt must not change or those passwords stop working.
    actual = crypto.createHash('sha256').update(`${process.env.BOARD_PASSWORD_SALT || 'aerix-board-salt'}:${password}`).digest('hex')
    expected = hash
  }
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

export function boardAccessMeta(board) {
  const obj = board.toObject ? board.toObject() : { ...board }
  delete obj.accessPasswordHash
  delete obj.editLinkToken
  delete obj.__v
  return { ...obj, hasPassword: Boolean(board.accessPasswordHash) }
}

export function hashSessionToken(token) {
  return typeof token === 'string' && token.length >= 32 && token.length <= 256
    ? crypto.createHash('sha256').update(token).digest('hex') : null
}

/**
 * Single source of truth for "may this caller see/edit this board?".
 * Used by every HTTP route and by the socket JOIN_BOARD handler.
 * `clientKey` (usually the IP) enables brute-force protection for board passwords.
 */
export async function canAccessBoard(board, { userId, password, sessionId, sessionToken, clientKey } = {}) {
  if (!board) return { allowed: false, reason: 'not_found' }

  const isOwner = Boolean(userId && board.ownerUid && board.ownerUid === userId)

  if (board.isLocked && !isOwner) {
    const resumeTokenHash = hashSessionToken(sessionToken)
    const existing = sessionId && resumeTokenHash
      ? await Session.exists({
        boardId: board.roomId, sessionId, resumeTokenHash, userId: userId || null,
        lastHeartbeat: { $gt: new Date(Date.now() - RESUME_WINDOW_MS) },
      })
      : null
    if (!existing) return { allowed: false, reason: 'locked' }
  }

  if (board.requireAuth && !userId) return { allowed: false, reason: 'auth' }

  if (board.accessPasswordHash && !isOwner) {
    const attemptKey = `${board.roomId}:${clientKey || 'unknown'}`
    if (passwordAttempts.blocked(attemptKey)) return { allowed: false, reason: 'rate_limited' }
    if (!password || !(await verifyBoardPassword(String(password), board.accessPasswordHash))) {
      // Only count real guesses, not page loads that simply carry no password yet.
      if (password) passwordAttempts.hit(attemptKey)
      return { allowed: false, reason: 'password' }
    }
    passwordAttempts.reset(attemptKey)
  }
  return { allowed: true, isOwner }
}

export const ROLES = ['editor', 'viewer']
export const newEditLinkToken = () => crypto.randomBytes(18).toString('base64url')

/** Constant-time check of an editor-link token against the board's current one. */
export function matchesEditLink(board, token) {
  if (typeof token !== 'string' || !token || token.length > 64 || !board.editLinkToken) return false
  const a = Buffer.from(token), b = Buffer.from(board.editLinkToken)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Editor or viewer? The owner always edits; a board without an owner has nobody to restrict access, so
 * everyone edits. Otherwise the host's explicit choice for this person wins, then the editor link, then
 * the board's general link setting.
 */
export function participantRole(board, { userId, hostRole, viaEditLink } = {}) {
  if (!board.ownerUid || (userId && board.ownerUid === userId)) return 'editor'
  if (hostRole) return hostRole
  if (board.linkAccess !== 'view' || viaEditLink) return 'editor'
  return 'viewer'
}

/** Role for an HTTP request, identified by the same session headers the socket uses. */
export async function requestRole(board, { userId, sessionId, sessionToken } = {}) {
  if (!board.ownerUid || (userId && board.ownerUid === userId)) return 'editor'
  const resumeTokenHash = hashSessionToken(sessionToken)
  const session = typeof sessionId === 'string' && resumeTokenHash
    ? await Session.findOne({ boardId: board.roomId, sessionId, resumeTokenHash }, { role: 1 }).lean()
    : null
  return session?.role || participantRole(board, { userId })
}

export async function isBoardOwner(boardId, userId) {
  if (!userId) return false
  return Boolean(await Board.exists({ roomId: boardId, ownerUid: userId }))
}
