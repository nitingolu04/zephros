import { Router } from 'express'
import { requireAuth, upsertUserFromToken } from '../middleware/auth.js'
import { User, UserBoard, Board, Session } from '../models/index.js'
import { identifier, badRequest } from '../lib/validation.js'

const router = Router()
router.use(requireAuth)

const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

function formatUser(user) {
  return { uid: user.firebaseUid, email: user.email, displayName: user.displayName, photoURL: user.photoURL }
}

// POST /api/auth/sync — upsert user profile after Firebase sign-in
router.post('/sync', route(async (req, res) => {
  res.json(formatUser(await upsertUserFromToken(req.user)))
}))

// GET /api/auth/me
router.get('/me', route(async (req, res) => {
  const user = await User.findOne({ firebaseUid: req.user.uid }).lean()
  res.json(formatUser(user || await upsertUserFromToken(req.user)))
}))

// PATCH /api/auth/profile — update display name
router.patch('/profile', route(async (req, res) => {
  const displayName = req.body?.displayName
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 80) {
    throw badRequest('Display name must be 1–80 characters')
  }
  const user = await User.findOneAndUpdate(
    { firebaseUid: req.user.uid },
    { $set: { displayName: displayName.trim() } },
    { new: true },
  )
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json(formatUser(user))
}))

// GET /api/auth/boards — the user's 50 most recent boards (3 queries total, not 2 per board)
router.get('/boards', route(async (req, res) => {
  const history = await UserBoard.find({ firebaseUid: req.user.uid }).sort({ lastVisited: -1 }).limit(50).lean()
  const ids = history.map(entry => entry.boardId)
  const [boards, counts] = await Promise.all([
    Board.find({ roomId: { $in: ids } }, { accessPasswordHash: 0 }).lean(),
    Session.aggregate([
      { $match: { boardId: { $in: ids }, lastHeartbeat: { $gte: new Date(Date.now() - 45000) } } },
      { $group: { _id: '$boardId', count: { $sum: 1 } } },
    ]),
  ])
  const boardById = new Map(boards.map(board => [board.roomId, board]))
  const countById = new Map(counts.map(row => [row._id, row.count]))

  res.json({
    boards: history.map(entry => {
      const board = boardById.get(entry.boardId)
      return {
        id: entry.boardId,
        title: board?.title || entry.title || 'Untitled Board',
        lastVisited: entry.lastVisited,
        exists: Boolean(board),
        persistent: Boolean(board?.persistent),
        isOwner: board?.ownerUid === req.user.uid,
        updatedAt: board?.updatedAt || null,
        lastEditedBy: board?.lastEditedBy || null,
        activeSessions: countById.get(entry.boardId) || 0,
      }
    }),
  })
}))

// POST /api/auth/boards/visit — record board visit
router.post('/boards/visit', route(async (req, res) => {
  // Validating the id as a plain string blocks operator injection such as {"$ne": null}.
  const boardId = identifier(req.body?.boardId, 'board id')
  const board = await Board.findOne({ roomId: boardId }, { title: 1 }).lean()
  if (!board) return res.status(404).json({ error: 'Board not found' })
  await UserBoard.updateOne(
    { firebaseUid: req.user.uid, boardId },
    { $set: { title: board.title, lastVisited: new Date() } },
    { upsert: true },
  )
  res.json({ success: true })
}))

export default router
