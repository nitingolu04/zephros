import { ChatMessage } from '../models/index.js'

export const CHAT_HISTORY_LIMIT = 100
const CHAT_RETENTION = 500

/** The wire format the frontend already understands. */
export function publicChatMessage(doc) {
  return {
    id: doc.id,
    message: doc.message,
    mentions: (doc.mentions || []).map(m => ({ sessionId: m.sessionId, username: m.username })),
    username: doc.username,
    color: doc.color,
    sessionId: doc.sessionId,
    timestamp: new Date(doc.createdAt).toISOString(),
    reactions: (doc.reactions || []).map(r => ({ emoji: r.emoji, sessionIds: [...r.sessionIds] })),
  }
}

/** Most recent messages, oldest first, for joiners and the REST history endpoint. */
export async function recentChat(boardId, limit = CHAT_HISTORY_LIMIT) {
  const docs = await ChatMessage.find({ boardId }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean()
  return docs.reverse().map(publicChatMessage)
}

/** Keep each board's chat bounded. Cheap: one indexed lookup, and a delete only when over the cap. */
export async function trimChat(boardId) {
  try {
    const cutoff = await ChatMessage.findOne({ boardId }, { createdAt: 1 }).sort({ createdAt: -1 }).skip(CHAT_RETENTION).lean()
    if (cutoff) await ChatMessage.deleteMany({ boardId, createdAt: { $lte: cutoff.createdAt } })
  } catch (err) {
    console.error('[Chat trim]', err.message)
  }
}
