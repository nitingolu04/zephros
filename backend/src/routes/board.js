import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { Board, Element, Session, UserBoard } from '../models/index.js'
import { verifyIdToken, isFirebaseConfigured } from '../lib/firebase.js'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import { boardAccessMeta, canAccessBoard, hashBoardPassword } from '../lib/boardAccess.js'

const router = Router()

async function getOwnerUid(req) {
  if (!isFirebaseConfigured()) return null
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const decoded = await verifyIdToken(header.slice(7))
  return decoded?.uid ?? null
}

function editorName(req) {
  return req.user?.name || req.user?.email?.split('@')[0] || 'User'
}

async function assertOwner(board, req, res) {
  if (!isFirebaseConfigured()) return true
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' })
    return false
  }
  if (board.ownerUid && board.ownerUid !== req.user.uid) {
    res.status(403).json({ error: 'Only the board owner can do this' })
    return false
  }
  return true
}

// POST /api/board/create
router.post('/create', async (req, res) => {
  try {
    const { title, persistent } = req.body
    const roomId = uuidv4().slice(0, 12)
    const ownerUid = await getOwnerUid(req)
    let lastEditedBy
    const header = req.headers.authorization
    if (header?.startsWith('Bearer ') && ownerUid) {
      const decoded = await verifyIdToken(header.slice(7))
      if (decoded) {
        lastEditedBy = {
          uid: decoded.uid,
          displayName: decoded.name || decoded.email?.split('@')[0] || 'User',
        }
      }
    }

    const board = await Board.create({
      title: title || 'Untitled Board',
      roomId,
      persistent: Boolean(persistent),
      ownerUid,
      ...(lastEditedBy ? { lastEditedBy } : {}),
    })

    res.json({
      boardId: board.roomId,
      roomId: board.roomId,
      shareUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/board/${board.roomId}`,
      board: boardAccessMeta(board),
    })
  } catch (err) {
    console.error('[Board Create]', err)
    res.status(500).json({ error: 'Failed to create board' })
  }
})

// POST /api/board/:id/duplicate
router.post('/:id/duplicate', requireAuth, async (req, res) => {
  try {
    const source = await Board.findOne({ roomId: req.params.id })
    if (!source) return res.status(404).json({ error: 'Board not found' })

    const newRoomId = uuidv4().slice(0, 12)
    const displayName = editorName(req)

    const board = await Board.create({
      title: `${source.title} (copy)`,
      roomId: newRoomId,
      persistent: false,
      ownerUid: req.user.uid,
      lastEditedBy: { uid: req.user.uid, displayName },
    })

    const elements = await Element.find({ boardId: source.roomId }).lean()
    if (elements.length > 0) {
      await Element.insertMany(
        elements.map((el) => {
          const { _id, ...rest } = el
          return {
            ...rest,
            id: uuidv4().slice(0, 16),
            boardId: newRoomId,
          }
        }),
      )
    }

    await UserBoard.findOneAndUpdate(
      { firebaseUid: req.user.uid, boardId: newRoomId },
      {
        firebaseUid: req.user.uid,
        boardId: newRoomId,
        title: board.title,
        lastVisited: new Date(),
      },
      { upsert: true },
    )

    res.json({
      boardId: board.roomId,
      roomId: board.roomId,
      shareUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/board/${board.roomId}`,
      board: boardAccessMeta(board),
    })
  } catch (err) {
    console.error('[Board Duplicate]', err)
    res.status(500).json({ error: 'Failed to duplicate board' })
  }
})

// GET /api/board/:id
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const board = await Board.findOne({ roomId: req.params.id })
    if (!board) {
      return res.status(404).json({ error: 'Board not found or session expired' })
    }

    const password = req.headers['x-board-password']
    const sessionId = req.headers['x-session-id']
    const access = await canAccessBoard(board, {
      userId: req.user?.uid,
      password: password ? String(password) : undefined,
      sessionId: sessionId ? String(sessionId) : undefined,
    })

    const meta = boardAccessMeta(board)
    if (!access.allowed) {
      return res.json({
        board: meta,
        elements: [],
        locked: true,
        reason: access.reason,
      })
    }

    const elements = await Element.find({ boardId: req.params.id }).lean()
    res.json({ board: meta, elements, locked: false })
  } catch (err) {
    console.error('[Board Get]', err)
    res.status(500).json({ error: 'Failed to fetch board' })
  }
})

// POST /api/board/:id/verify-access
router.post('/:id/verify-access', async (req, res) => {
  try {
    const board = await Board.findOne({ roomId: req.params.id })
    if (!board) return res.status(404).json({ error: 'Board not found' })
    if (!board.accessPasswordHash) return res.json({ valid: true })

    const { password } = req.body
    if (password && hashBoardPassword(password) === board.accessPasswordHash) {
      return res.json({ valid: true })
    }
    res.status(403).json({ valid: false, error: 'Invalid password' })
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' })
  }
})

// DELETE /api/board/:id — owner only
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const board = await Board.findOne({ roomId: req.params.id })
    if (!board) return res.status(404).json({ error: 'Board not found' })
    if (!(await assertOwner(board, req, res))) return

    await Board.deleteOne({ roomId: req.params.id })
    await Element.deleteMany({ boardId: req.params.id })
    await Session.deleteMany({ boardId: req.params.id })
    await UserBoard.deleteMany({ boardId: req.params.id })

    res.json({ success: true })
  } catch (err) {
    console.error('[Board Delete]', err)
    res.status(500).json({ error: 'Failed to delete board' })
  }
})

// PATCH /api/board/:id — rename or toggle persistent (owner required to save)
router.patch('/:id', optionalAuth, async (req, res) => {
  try {
    const board = await Board.findOne({ roomId: req.params.id })
    if (!board) return res.status(404).json({ error: 'Board not found' })

    const { title, persistent, requireAuth: requireAuthFlag, isLocked: isLockedFlag, password, clearPassword } = req.body
    if (persistent !== undefined && !(await assertOwner(board, req, res))) return
    if ((requireAuthFlag !== undefined || isLockedFlag !== undefined || password !== undefined || clearPassword) && !(await assertOwner(board, req, res))) return

    const updates = {}
    if (title !== undefined) updates.title = title || 'Untitled Board'
    if (persistent !== undefined) updates.persistent = Boolean(persistent)
    if (requireAuthFlag !== undefined) updates.requireAuth = Boolean(requireAuthFlag)
    if (isLockedFlag !== undefined) updates.isLocked = Boolean(isLockedFlag)
    if (clearPassword) updates.accessPasswordHash = null
    else if (password !== undefined && password !== '') {
      updates.accessPasswordHash = hashBoardPassword(password)
    }

    if (req.user && !board.ownerUid && (persistent !== undefined || requireAuthFlag !== undefined || isLockedFlag !== undefined || password !== undefined || clearPassword)) {
      updates.ownerUid = req.user.uid
    }

    const updated = await Board.findOneAndUpdate(
      { roomId: req.params.id },
      updates,
      { new: true },
    )
    res.json({ success: true, board: boardAccessMeta(updated) })
  } catch (err) {
    console.error('[Board Patch]', err)
    res.status(500).json({ error: 'Failed to update board' })
  }
})

// GET /api/board/:id/export/json
router.get('/:id/export/json', async (req, res) => {
  try {
    const board = await Board.findOne({ roomId: req.params.id })
    if (!board) return res.status(404).json({ error: 'Board not found' })

    const elements = await Element.find({ boardId: req.params.id }).lean()
    res.json({ board, elements })
  } catch (err) {
    res.status(500).json({ error: 'Export failed' })
  }
})

// POST /api/board/save (save temporary state)
router.post('/save', async (req, res) => {
  try {
    const { boardId, elements } = req.body
    if (!boardId) return res.status(400).json({ error: 'boardId required' })

    for (const el of elements) {
      await Element.findOneAndUpdate(
        { id: el.id, boardId },
        { ...el, boardId },
        { upsert: true, new: true },
      )
    }

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Save failed' })
  }
})

export default router
