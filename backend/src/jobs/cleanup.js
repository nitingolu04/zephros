import { Board, BoardVersion, ChatMessage, Element, Session, UserBoard, Attendance } from '../models/index.js'
import { inRoom } from '../lib/roomQueue.js'
import { autoSnapshotActiveBoards } from '../lib/versions.js'

/** Everything that belongs to a board. Used by the cleanup job and the owner's delete route. */
export async function deleteBoardData(roomId) {
  await Promise.all([
    Element.deleteMany({ boardId: roomId }),
    Session.deleteMany({ boardId: roomId }),
    UserBoard.deleteMany({ boardId: roomId }),
    ChatMessage.deleteMany({ boardId: roomId }),
    BoardVersion.deleteMany({ boardId: roomId }),
    Attendance.deleteMany({ boardId: roomId }),
  ])
}

export async function cleanupExpiredBoards() {
  const cutoff = new Date(Date.now() - 120000)
  await Session.deleteMany({ lastHeartbeat: { $lt: cutoff } })
  const candidates = await Board.find({ persistent: false, updatedAt: { $lt: cutoff } }).lean()
  for (const board of candidates) {
    await inRoom(board.roomId, async () => {
      if (await Session.exists({ boardId: board.roomId, lastHeartbeat: { $gte: cutoff } })) return
      const removed = await Board.deleteOne({ _id: board._id, persistent: false, updatedAt: { $lt: cutoff } })
      if (!removed.deletedCount) return
      await deleteBoardData(board.roomId)
    })
  }
}

export function startCleanupWorker() {
  // Grace period protects temporary boards during reloads and network interruptions.
  const cleanup = setInterval(() => {
    cleanupExpiredBoards().catch(err => console.error('[Cleanup]', err.message))
  }, 60000)
  // Auto version history: snapshot boards being edited, at most every 2 minutes, only on change.
  const snapshots = setInterval(() => {
    autoSnapshotActiveBoards().catch(err => console.error('[AutoSnapshot]', err.message))
  }, 120000)
  cleanup.unref()
  snapshots.unref()
  return { stop: () => { clearInterval(cleanup); clearInterval(snapshots) } }
}
