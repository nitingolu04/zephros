import crypto from 'node:crypto'
import { Board, BoardVersion, Element, Session } from '../models/index.js'
import { canvasFields } from './validation.js'
import { inRoom } from './roomQueue.js'

const MAX_AUTO = 20
const MAX_MANUAL = 50
// MongoDB documents are capped at 16 MB; leave headroom for metadata.
const MAX_SNAPSHOT_BYTES = 14 * 1024 * 1024

const ELEMENT_PROJECTION = { _id: 0, __v: 0, boardId: 0, createdAt: 0, updatedAt: 0 }

function fingerprintOf(elements) {
  const sorted = [...elements].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

export function publicVersion(version) {
  return {
    id: String(version._id),
    label: version.label,
    auto: version.auto,
    count: version.count,
    createdBy: version.createdBy?.username ? version.createdBy : null,
    createdAt: version.createdAt,
  }
}

async function prune(boardId) {
  for (const [auto, keep] of [[true, MAX_AUTO], [false, MAX_MANUAL]]) {
    const stale = await BoardVersion.find({ boardId, auto }, { _id: 1 }).sort({ createdAt: -1 }).skip(keep).lean()
    if (stale.length) await BoardVersion.deleteMany({ _id: { $in: stale.map(v => v._id) } })
  }
}

/**
 * Snapshot the board as stored in the database (never a client-supplied payload).
 * Returns null when `skipIfUnchanged` is set and the board matches its latest version.
 */
export async function createSnapshot(boardId, { label, auto = false, createdBy = null, skipIfUnchanged = false } = {}) {
  const elements = await Element.find({ boardId }, ELEMENT_PROJECTION).lean()
  const fingerprint = fingerprintOf(elements)
  if (skipIfUnchanged) {
    const latest = await BoardVersion.findOne({ boardId }, { fingerprint: 1 }).sort({ createdAt: -1 }).lean()
    if (latest?.fingerprint === fingerprint) return null
  }
  if (Buffer.byteLength(JSON.stringify(elements)) > MAX_SNAPSHOT_BYTES) {
    throw Object.assign(new Error('Board is too large to snapshot (remove some large images)'), { status: 413 })
  }
  const version = await BoardVersion.create({
    boardId,
    label: (label || '').trim().slice(0, 80) || (auto ? 'Auto-save' : 'Saved version'),
    auto,
    createdBy: createdBy || { uid: null, username: null },
    count: elements.length,
    fingerprint,
    elements,
  })
  await prune(boardId)
  return version
}

/**
 * Replace the board's elements with a version, inside the board's write queue so no live
 * edit can interleave. A "Before restore" snapshot is taken first, so a restore is reversible.
 */
export function restoreVersion(io, boardId, versionId, by) {
  return inRoom(boardId, async () => {
    const version = await BoardVersion.findOne({ _id: versionId, boardId }).lean()
    if (!version) throw Object.assign(new Error('Version not found'), { status: 404 })
    // Validate everything before touching the live board.
    const restored = version.elements.map(el => ({ ...canvasFields(el, true), boardId, createdBy: el.createdBy }))

    await createSnapshot(boardId, { label: `Before restoring "${version.label}"`, auto: true, createdBy: by })
    await Element.deleteMany({ boardId })
    if (restored.length) await Element.insertMany(restored, { ordered: false })
    await Board.updateOne({ roomId: boardId }, { $set: { lastEditedBy: { uid: by?.uid ?? null, displayName: by?.username ?? 'User' } } })

    const elements = await Element.find({ boardId }).lean()
    io?.to(boardId).emit('SYNC_STATE', { elements })
    io?.to(boardId).emit('ACTIVITY_EVENT', {
      id: crypto.randomUUID(),
      message: `${by?.username || 'Someone'} restored "${version.label}"`,
      username: by?.username || 'User',
      color: '#D9480F',
      timestamp: new Date().toISOString(),
      type: 'restore',
    })
    return { count: elements.length, label: version.label }
  })
}

/** Background job: snapshot boards that people are actively editing, only when they changed. */
export async function autoSnapshotActiveBoards() {
  const since = new Date(Date.now() - 2 * 60 * 1000)
  const active = await Session.distinct('boardId', { lastHeartbeat: { $gte: since } })
  let created = 0
  for (const boardId of active) {
    try {
      const snapshot = await inRoom(boardId, () => createSnapshot(boardId, { auto: true, skipIfUnchanged: true }))
      if (snapshot) created++
    } catch (err) {
      if (err.status !== 413) console.error('[AutoSnapshot]', boardId, err.message)
    }
  }
  return created
}
