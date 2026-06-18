import { Router } from 'express'
import { requireAuth, upsertUserFromToken } from '../middleware/auth.js'
import { User, UserBoard, Board, Session } from '../models/index.js'

const router = Router()

function formatUser(user) {
  return {
    uid: user.firebaseUid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  }
}

// POST /api/auth/sync — upsert user profile after Firebase sign-in
router.post('/sync', requireAuth, async (req, res) => {
  try {
    const user = await upsertUserFromToken(req.user)
    res.json(formatUser(user))
  } catch (err) {
    console.error('[Auth Sync]', err)
    res.status(500).json({ error: 'Failed to sync user' })
  }
})

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid }).lean()
    if (!user) {
      const created = await upsertUserFromToken(req.user)
      return res.json(formatUser(created))
    }
    res.json(formatUser(user))
  } catch (err) {
    console.error('[Auth Me]', err)
    res.status(500).json({ error: 'Failed to fetch user' })
  }
})

// PATCH /api/auth/profile — update display name
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { displayName } = req.body
    if (!displayName?.trim()) {
      return res.status(400).json({ error: 'Display name is required' })
    }

    const user = await User.findOneAndUpdate(
      { firebaseUid: req.user.uid },
      { displayName: displayName.trim() },
      { new: true },
    )

    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json(formatUser(user))
  } catch (err) {
    console.error('[Auth Profile]', err)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// GET /api/auth/boards — user's board history
router.get('/boards', requireAuth, async (req, res) => {
  try {
    const history = await UserBoard.find({ firebaseUid: req.user.uid })
      .sort({ lastVisited: -1 })
      .limit(50)
      .lean()

    const boards = await Promise.all(
      history.map(async (entry) => {
        const board = await Board.findOne({ roomId: entry.boardId }).lean()
        const activeSessions = board
          ? await Session.countDocuments({ boardId: entry.boardId })
          : 0
        return {
          id: entry.boardId,
          title: board?.title || entry.title || 'Untitled Board',
          lastVisited: entry.lastVisited,
          exists: Boolean(board),
          persistent: Boolean(board?.persistent),
          isOwner: board?.ownerUid === req.user.uid,
          updatedAt: board?.updatedAt || null,
          lastEditedBy: board?.lastEditedBy || null,
          activeSessions,
        }
      }),
    )

    res.json({ boards })
  } catch (err) {
    console.error('[Auth Boards]', err)
    res.status(500).json({ error: 'Failed to fetch boards' })
  }
})

// POST /api/auth/boards/visit — record board visit
router.post('/boards/visit', requireAuth, async (req, res) => {
  try {
    const { boardId, title } = req.body
    if (!boardId) return res.status(400).json({ error: 'boardId is required' })

    const board = await Board.findOne({ roomId: boardId }).lean()
    const resolvedTitle = board?.title || title || 'Untitled Board'

    await UserBoard.findOneAndUpdate(
      { firebaseUid: req.user.uid, boardId },
      {
        firebaseUid: req.user.uid,
        boardId,
        title: resolvedTitle,
        lastVisited: new Date(),
      },
      { upsert: true, new: true },
    )

    res.json({ success: true })
  } catch (err) {
    console.error('[Auth Board Visit]', err)
    res.status(500).json({ error: 'Failed to record visit' })
  }
})

export default router
