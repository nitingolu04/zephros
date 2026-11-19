import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { Board, BoardVersion, Element, Session, UserBoard } from '../models/index.js'
import { deleteBoardData } from '../jobs/cleanup.js'
import { createSnapshot, publicVersion, restoreVersion } from '../lib/versions.js'
import { recentChat } from '../lib/chat.js'
import { inRoom } from '../lib/roomQueue.js'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import { boardAccessMeta, canAccessBoard, hashBoardPassword, newEditLinkToken, requestRole } from '../lib/boardAccess.js'
import { titleValue, badRequest } from '../lib/validation.js'
import { getAllowedOrigins } from '../lib/cors.js'
import { attendanceFileName, attendanceReport, attendanceWorkbook, validTimeZone } from '../lib/attendance.js'
import { isSessionOnline, refreshRoles } from '../socket/handler.js'

const router = Router()
router.use(optionalAuth)

const newRoomId = () => randomUUID().slice(0, 12)
const shareUrl = roomId => `${getAllowedOrigins()[0]}/board/${roomId}`
const SETTINGS = ['persistent', 'requireAuth', 'isLocked', 'password', 'clearPassword', 'linkAccess']

// Wrap async handlers so thrown errors reach the central JSON error handler.
const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

function accessOptions(req) {
  return {
    userId: req.user?.uid,
    password: req.headers['x-board-password'],
    sessionId: req.headers['x-session-id'],
    sessionToken: req.headers['x-session-token'],
    clientKey: req.ip,
  }
}

function deny(res, reason) {
  const status = reason === 'rate_limited' ? 429 : 403
  const error = reason === 'rate_limited' ? 'Too many wrong passwords; try again later' : 'Board access denied'
  res.status(status).json({ error, reason })
}

async function assertAccess(board, req, res) {
  const access = await canAccessBoard(board, accessOptions(req))
  if (!access.allowed) deny(res, access.reason)
  return access.allowed
}

function assertOwner(board, req, res) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' })
    return false
  }
  if (!board.ownerUid || board.ownerUid !== req.user.uid) {
    res.status(403).json({ error: 'Only the board owner can do this' })
    return false
  }
  return true
}

function validateSettings(body) {
  for (const key of ['persistent', 'requireAuth', 'isLocked', 'clearPassword']) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') throw badRequest(`Invalid ${key}`)
  }
  if (body.linkAccess !== undefined && !['edit', 'view'].includes(body.linkAccess)) throw badRequest('Invalid linkAccess')
  if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length > 256)) {
    throw badRequest('Password must be at most 256 characters')
  }
}

function editor(req) {
  return req.user ? { uid: req.user.uid, displayName: req.user.name || req.user.email?.split('@')[0] || 'User' } : undefined
}

async function findBoard(req, res) {
  const board = await Board.findOne({ roomId: req.params.id })
  if (!board) res.status(404).json({ error: 'Board not found or session expired' })
  return board
}

// POST /api/board/create
router.post('/create', route(async (req, res) => {
  const { title, persistent } = req.body ?? {}
  validateSettings(req.body ?? {})
  if (persistent && !req.user) return res.status(401).json({ error: 'Sign in to create a saved board' })

  const board = await Board.create({
    title: title === undefined ? 'Untitled Board' : titleValue(title),
    roomId: newRoomId(),
    persistent: Boolean(persistent),
    ownerUid: req.user?.uid ?? null,
    ...(req.user ? { lastEditedBy: editor(req) } : {}),
  })
  res.status(201).json({ boardId: board.roomId, roomId: board.roomId, shareUrl: shareUrl(board.roomId), board: boardAccessMeta(board) })
}))

// POST /api/board/:id/duplicate — signed-in users copy a board they can access
router.post('/:id/duplicate', requireAuth, route(async (req, res) => {
  const source = await findBoard(req, res)
  if (!source || !(await assertAccess(source, req, res))) return

  const roomId = newRoomId()
  // Duplicates are made from the dashboard, so they are saved boards owned by the caller.
  const board = await Board.create({
    title: titleValue(`${source.title} (copy)`.slice(0, 200)),
    roomId,
    persistent: true,
    ownerUid: req.user.uid,
    lastEditedBy: editor(req),
  })

  const elements = await Element.find({ boardId: source.roomId }).lean()
  if (elements.length) {
    await Element.insertMany(elements.map(({ _id, __v, createdAt, updatedAt, ...rest }) => ({
      ...rest, id: randomUUID().slice(0, 16), boardId: roomId,
    })))
  }
  await UserBoard.updateOne(
    { firebaseUid: req.user.uid, boardId: roomId },
    { $set: { title: board.title, lastVisited: new Date() } },
    { upsert: true },
  )
  res.status(201).json({ boardId: roomId, roomId, shareUrl: shareUrl(roomId), board: boardAccessMeta(board) })
}))

// GET /api/board/:id — board plus elements, or a minimal "locked" stub
router.get('/:id', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board) return
  const access = await canAccessBoard(board, accessOptions(req))
  if (!access.allowed) {
    // Expose only what the access gate needs to render; never owner ids or edit history.
    return res.status(access.reason === 'rate_limited' ? 429 : 200).json({
      board: {
        roomId: board.roomId, title: board.title, requireAuth: board.requireAuth,
        isLocked: board.isLocked, hasPassword: Boolean(board.accessPasswordHash),
      },
      elements: [],
      locked: true,
      reason: access.reason,
    })
  }
  const elements = await Element.find({ boardId: board.roomId }).lean()
  res.json({ board: boardAccessMeta(board), elements, locked: false })
}))

// POST /api/board/:id/verify-access — check a board password (rate limited per board + IP)
router.post('/:id/verify-access', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board) return
  if (!board.accessPasswordHash) return res.json({ valid: true })
  const password = req.body?.password
  if (typeof password !== 'string' || !password) return res.status(400).json({ valid: false, error: 'Password is required' })
  const access = await canAccessBoard({ roomId: board.roomId, accessPasswordHash: board.accessPasswordHash }, { password, clientKey: req.ip })
  if (access.allowed) return res.json({ valid: true })
  if (access.reason === 'rate_limited') return res.status(429).json({ valid: false, error: 'Too many wrong passwords; try again later' })
  res.status(403).json({ valid: false, error: 'Invalid password' })
}))

// DELETE /api/board/:id — owner only; connected participants are notified and removed
router.delete('/:id', requireAuth, route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board || !assertOwner(board, req, res)) return

  const roomId = board.roomId
  await Board.deleteOne({ _id: board._id })
  await deleteBoardData(roomId)
  const io = req.app.get('io')
  io?.to(roomId).emit('BOARD_DELETED', { boardId: roomId })
  io?.in(roomId).socketsLeave(roomId)
  res.json({ success: true })
}))

// PATCH /api/board/:id — rename (any participant) or change settings (owner only)
router.patch('/:id', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board) return
  const body = req.body ?? {}
  validateSettings(body)

  const changesSettings = SETTINGS.some(key => body[key] !== undefined)
  if (changesSettings && !assertOwner(board, req, res)) return
  if (!changesSettings && !(await assertAccess(board, req, res))) return
  if (!changesSettings && (await requestRole(board, accessOptions(req))) === 'viewer') {
    return res.status(403).json({ error: 'You have view-only access to this board' })
  }

  const updates = {}
  if (body.title !== undefined) updates.title = titleValue(body.title)
  if (body.persistent !== undefined) updates.persistent = body.persistent
  if (body.requireAuth !== undefined) updates.requireAuth = body.requireAuth
  if (body.isLocked !== undefined) updates.isLocked = body.isLocked
  if (body.linkAccess !== undefined) updates.linkAccess = body.linkAccess
  if (body.clearPassword) updates.accessPasswordHash = null
  else if (body.password) updates.accessPasswordHash = await hashBoardPassword(body.password)
  if (!Object.keys(updates).length) return res.json({ success: true, board: boardAccessMeta(board) })
  if (req.user) updates.lastEditedBy = editor(req)

  const updated = await Board.findOneAndUpdate({ _id: board._id }, { $set: updates }, { new: true })
  const meta = boardAccessMeta(updated)
  // Keep every open tab in sync (title, lock state, saved state).
  req.app.get('io')?.to(updated.roomId).emit('BOARD_UPDATED', {
    title: meta.title, persistent: meta.persistent, requireAuth: meta.requireAuth,
    isLocked: meta.isLocked, hasPassword: meta.hasPassword, linkAccess: meta.linkAccess,
  })
  if (updates.linkAccess && updates.linkAccess !== board.linkAccess) await refreshRoles(req.app.get('io'), updated.roomId)
  if (updates.title) await UserBoard.updateMany({ boardId: updated.roomId }, { $set: { title: updates.title } })
  res.json({ success: true, board: meta })
}))

/* ── Share settings (owner only) ── */
// GET /api/board/:id/share — the link setting and the secret editor link (created on first use)
router.get('/:id/share', route(async (req, res) => {
  const board = await Board.findOne({ roomId: req.params.id }).select('+editLinkToken')
  if (!board) return res.status(404).json({ error: 'Board not found or session expired' })
  if (!assertOwner(board, req, res)) return
  if (!board.editLinkToken) {
    board.editLinkToken = newEditLinkToken()
    await board.save()
  }
  res.json({ linkAccess: board.linkAccess || 'edit', editLinkToken: board.editLinkToken })
}))

// POST /api/board/:id/share/reset — new editor link; people who joined through the old one lose edit access
router.post('/:id/share/reset', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board || !assertOwner(board, req, res)) return
  const editLinkToken = newEditLinkToken()
  await Board.updateOne({ _id: board._id }, { editLinkToken })
  await Session.updateMany({ boardId: board.roomId, viaEditLink: true }, { viaEditLink: false })
  await refreshRoles(req.app.get('io'), board.roomId)
  res.json({ linkAccess: board.linkAccess || 'edit', editLinkToken })
}))

// GET /api/board/:id/export/json
router.get('/:id/export/json', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board || !(await assertAccess(board, req, res))) return
  const elements = await Element.find({ boardId: board.roomId }, { __v: 0 }).lean()
  res.json({ board: boardAccessMeta(board), elements, exportedAt: new Date().toISOString() })
}))

/* ── Chat history ── */

// GET /api/board/:id/chat?limit=100 — recent messages, oldest first
// GET /api/board/:id/attendance?tz=Asia/Kolkata — Excel register of everyone who joined the board.
// Only the owner (the teacher) may download it; on a board without an owner, any participant may.
router.get('/:id/attendance', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board || !(await assertAccess(board, req, res))) return
  if (board.ownerUid && board.ownerUid !== req.user?.uid) {
    return res.status(req.user ? 403 : 401).json({ error: 'Only the board owner can download attendance' })
  }
  const timeZone = validTimeZone(req.query.tz)
  const now = new Date()
  const rows = await attendanceReport(board.roomId, sessionId => isSessionOnline(board.roomId, sessionId), now)
  const file = attendanceWorkbook(board, rows, timeZone, now)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${attendanceFileName(board, timeZone, now)}"`)
  res.setHeader('Cache-Control', 'no-store')
  res.send(file)
}))

router.get('/:id/chat', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board || !(await assertAccess(board, req, res))) return
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 100))
  res.json({ messages: await recentChat(board.roomId, limit) })
}))

/* ── Version history ── */

/** Restoring or deleting history is the owner's call; on a board without an owner, any participant may. */
function canManageHistory(board, req) {
  return !board.ownerUid || board.ownerUid === req.user?.uid
}

function versionAuthor(req) {
  const name = typeof req.body?.author === 'string' ? req.body.author.trim().slice(0, 80) : ''
  return { uid: req.user?.uid ?? null, username: req.user ? editor(req).displayName : name || 'Guest' }
}

async function findVersion(req, res, board, withElements = false) {
  if (!mongoose.isValidObjectId(req.params.versionId)) {
    res.status(400).json({ error: 'Invalid version id' })
    return null
  }
  const version = await BoardVersion.findOne({ _id: req.params.versionId, boardId: board.roomId }, withElements ? {} : { elements: 0 }).lean()
  if (!version) res.status(404).json({ error: 'Version not found' })
  return version
}

// GET /api/board/:id/versions — newest first, without the (potentially large) snapshots
router.get('/:id/versions', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board || !(await assertAccess(board, req, res))) return
  const versions = await BoardVersion.find({ boardId: board.roomId }, { elements: 0, fingerprint: 0 }).sort({ createdAt: -1 }).lean()
  res.json({ versions: versions.map(publicVersion), canManage: canManageHistory(board, req) })
}))

// POST /api/board/:id/versions { label?, author? } — snapshot the board as stored on the server
router.post('/:id/versions', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board || !(await assertAccess(board, req, res))) return
  if ((await requestRole(board, accessOptions(req))) === 'viewer') return res.status(403).json({ error: 'You have view-only access to this board' })
  const label = req.body?.label
  if (label !== undefined && (typeof label !== 'string' || label.length > 80)) throw badRequest('Label must be at most 80 characters')
  const version = await inRoom(board.roomId, () => createSnapshot(board.roomId, { label, createdBy: versionAuthor(req) }))
  res.status(201).json({ version: publicVersion(version) })
}))

// GET /api/board/:id/versions/:versionId — one version including its elements (for previews)
router.get('/:id/versions/:versionId', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board || !(await assertAccess(board, req, res))) return
  const version = await findVersion(req, res, board, true)
  if (version) res.json({ version: { ...publicVersion(version), elements: version.elements } })
}))

// POST /api/board/:id/versions/:versionId/restore — replace the live board for everyone
router.post('/:id/versions/:versionId/restore', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board || !(await assertAccess(board, req, res))) return
  if (!canManageHistory(board, req)) return res.status(403).json({ error: 'Only the board owner can restore versions' })
  if (!(await findVersion(req, res, board))) return
  const result = await restoreVersion(req.app.get('io'), board.roomId, req.params.versionId, versionAuthor(req))
  res.json({ success: true, ...result })
}))

// DELETE /api/board/:id/versions/:versionId
router.delete('/:id/versions/:versionId', route(async (req, res) => {
  const board = await findBoard(req, res)
  if (!board || !(await assertAccess(board, req, res))) return
  if (!canManageHistory(board, req)) return res.status(403).json({ error: 'Only the board owner can delete versions' })
  const version = await findVersion(req, res, board)
  if (!version) return
  await BoardVersion.deleteOne({ _id: version._id })
  res.json({ success: true })
}))

// Legacy HTTP save is intentionally disabled: all live writes use the authorized socket pipeline.
router.post('/save', (_req, res) => {
  res.status(410).json({ error: 'Use the connected board to save changes' })
})

export default router
