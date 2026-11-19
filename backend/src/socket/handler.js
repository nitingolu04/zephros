import { markJoin, markLeave, markCallJoin, markCallLeave, touch } from '../lib/attendance.js'
import { randomUUID } from 'node:crypto'
import { Board, ChatMessage, Element, Session } from '../models/index.js'
import { publicChatMessage, recentChat, trimChat } from '../lib/chat.js'
import { verifyIdToken, isFirebaseConfigured } from '../lib/firebase.js'
import { canAccessBoard, isBoardOwner, hashSessionToken, participantRole, matchesEditLink, ROLES } from '../lib/boardAccess.js'

import { identifier, plainObject, canvasFields, badRequest } from '../lib/validation.js'
import { inRoom } from '../lib/roomQueue.js'
import { applyPatches, diffElements } from '../lib/canvasHistory.js'

// In-memory cursor positions for performance
const roomCursors = new Map() // roomId -> Map<sessionId, cursorData>

// Voice/video call tracking
const callParticipants = new Map() // boardId -> Map<sessionId, { socketId, username, color, audio, video }>
const socketRegistry = new Map() // socketId -> { boardId, sessionId }
const sessionSockets = new Map() // `${boardId}:${sessionId}` -> socketId
const sessionRoles = new Map() // `${boardId}:${sessionId}` -> 'editor' | 'viewer' (checked on every write)

// In-memory screen share state
const screenSharers = new Map() // boardId -> { sessionId, username }

// "Last edited by" + updatedAt (which keeps temporary boards alive) are written at most
// every few seconds per board, instead of once per drag frame.
const META_THROTTLE_MS = 5000
const lastMetaWrite = new Map() // boardId -> timestamp
function touchBoardMeta(boardId, socket, username) {
  const now = Date.now()
  if (now - (lastMetaWrite.get(boardId) || 0) < META_THROTTLE_MS) return
  lastMetaWrite.set(boardId, now)
  const uid = socket.data?.authUid || null
  const displayName = socket.data?.authName || username || 'User'
  Board.updateOne({ roomId: boardId }, { $set: { lastEditedBy: { uid, displayName } } }).catch(() => {})
}

// High-frequency, fire-and-forget events: never queued behind database writes.
const EPHEMERAL_EVENTS = new Set(['CURSOR_MOVE', 'LASER_POINTER', 'CHAT_TYPING', 'USER_DRAWING'])
const MUTATING_EVENTS = new Set(['ADD_ELEMENT', 'UPDATE_ELEMENT', 'DELETE_ELEMENT', 'CLEAR_BOARD', 'SYNC_STATE'])
const MAX_SIGNAL_BYTES = 64 * 1024

const finite = value => typeof value === 'number' && Number.isFinite(value)
function shortString(value, name, max = 32) {
  if (typeof value !== 'string' || !value || value.length > max) throw badRequest(`Invalid ${name}`)
  return value
}
/** WebRTC SDP offers/answers and ICE candidates: small plain objects only. */
function signal(value, name) {
  plainObject(value)
  if (JSON.stringify(value).length > MAX_SIGNAL_BYTES) throw badRequest(`Oversized ${name}`)
  return value
}
function clientAddress(socket) {
  // With one trusted proxy (Render/Railway), the last X-Forwarded-For hop is the real client.
  const forwarded = socket.handshake.headers['x-forwarded-for']
  return (typeof forwarded === 'string' && forwarded.split(',').pop().trim()) || socket.handshake.address
}
function activity(type, message, session) {
  return {
    id: randomUUID(),
    message,
    username: session?.username || 'User',
    color: session?.color || '#6366F1',
    timestamp: new Date().toISOString(),
    type,
  }
}

function getScreenSharer(boardId) {
  return screenSharers.get(boardId) ?? null
}

const STALE_SESSION_MS = 45000

function normalizeUsername(username) {
  return (username || '').toLowerCase().trim()
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One row per person — matches by userId OR username (case-insensitive) */
function dedupeSessions(users) {
  const sorted = [...users].sort(
    (a, b) => new Date(b.lastHeartbeat) - new Date(a.lastHeartbeat),
  )
  const kept = []
  for (const u of sorted) {
    const name = normalizeUsername(u.username)
    const isDupe = kept.some((k) => {
      if (u.userId && k.userId && u.userId === k.userId) return true
      if (u.sessionId === k.sessionId) return true
      return false
    })
    if (!isDupe) kept.push(u)
  }
  return kept
}

async function pruneStaleSessions(io, boardId) {
  const cutoff = new Date(Date.now() - STALE_SESSION_MS)
  const stale = await Session.find({ boardId, lastHeartbeat: { $lt: cutoff } }).lean()
  for (const s of stale) {
    const sid = sessionSockets.get(`${boardId}:${s.sessionId}`)
    if (sid) io.sockets.sockets.get(sid)?.disconnect(true)
    sessionSockets.delete(`${boardId}:${s.sessionId}`)
  }
  if (stale.length > 0) {
    await Session.deleteMany({ boardId, lastHeartbeat: { $lt: cutoff } })
  }
}

async function getBoardUsers(io, boardId) {
  await pruneStaleSessions(io, boardId)
  return dedupeSessions((await Session.find({ boardId }).lean()).filter(s => sessionSockets.has(`${boardId}:${s.sessionId}`)))
}

async function removeDuplicateSessions(io, boardId, userId, username, keepSessionId) {
  const normalizedName = normalizeUsername(username)
  const orConditions = []
  if (userId) orConditions.push({ userId })
  if (!orConditions.length) return

  const query = {
    boardId,
    sessionId: { $ne: keepSessionId },
    $or: orConditions,
  }
  const stale = await Session.find(query).lean()
  for (const s of stale) {
    const sid = sessionSockets.get(`${boardId}:${s.sessionId}`)
    if (sid) io.sockets.sockets.get(sid)?.disconnect(true)
    sessionSockets.delete(`${boardId}:${s.sessionId}`)
  }
  await Session.deleteMany(query)
}

function getCallMap(boardId) {
  if (!callParticipants.has(boardId)) callParticipants.set(boardId, new Map())
  return callParticipants.get(boardId)
}

function emitToBoardSession(io, boardId, sessionId, event, data) {
  const sid = sessionSockets.get(`${boardId}:${sessionId}`)
  if (sid) {
    io.to(sid).emit(event, data)
    return true
  }
  return false
}

/** Direct socket first; fall back to room emit with targetSessionId for client filtering */
function relayToSession(io, boardId, targetSessionId, event, data) {
  const payload = { ...data, targetSessionId }
  if (!emitToBoardSession(io, boardId, targetSessionId, event, payload)) {
    io.to(boardId).emit(event, payload)
  }
}

function emitToSession(io, boardId, sessionId, event, data) {
  const peer = getCallMap(boardId).get(sessionId)
  if (peer?.socketId) io.to(peer.socketId).emit(event, data)
}

/**
 * Recompute everyone's role after the host changes the link setting or resets the editor link,
 * and tell each affected person immediately.
 */
export async function refreshRoles(io, boardId) {
  const board = await Board.findOne({ roomId: boardId }).lean()
  if (!board) return
  const sessions = await Session.find({ boardId }).lean()
  for (const s of sessions) {
    const role = participantRole(board, s)
    if (role === s.role) continue
    await Session.updateOne({ _id: s._id }, { role })
    const key = `${boardId}:${s.sessionId}`
    if (sessionRoles.has(key)) {
      sessionRoles.set(key, role)
      emitToBoardSession(io, boardId, s.sessionId, 'ROLE_UPDATED', { role })
    }
  }
  io.to(boardId).emit('PRESENCE_UPDATE', await getBoardUsers(io, boardId))
}

/** Is this participant connected to the board right now? (Used by the attendance export.) */
export function isSessionOnline(boardId, sessionId) {
  return sessionSockets.has(`${boardId}:${sessionId}`)
}

function leaveCall(io, boardId, sessionId) {
  const map = getCallMap(boardId)
  if (!map.has(sessionId)) return
  map.delete(sessionId)
  markCallLeave(boardId, sessionId).catch(err => console.error('[Attendance]', err.message))
  if (map.size === 0) callParticipants.delete(boardId)
  io.to(boardId).emit('USER_CALL_LEFT', { sessionId })
}

function cleanupSocketCall(io, socketId) {
  const reg = socketRegistry.get(socketId)
  if (!reg) return
  leaveCall(io, reg.boardId, reg.sessionId)
  socketRegistry.delete(socketId)
}

export function setupSocket(io) {
  io.use(async (socket, next) => {
    if (!isFirebaseConfigured()) {
      return next()
    }

    const token = socket.handshake.auth?.token
    if (!token) {
      return next()
    }

    const decoded = await verifyIdToken(token)
    if (!decoded) {
      return next(new Error('Invalid authentication token'))
    }

    socket.data.authName = decoded.name || decoded.email?.split('@')[0] || 'User'
    socket.data.authUid = decoded.uid
    next()
  })

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`)

    let currentRoom = null
    let currentSession = null
    let hasLeft = true
    let chain = Promise.resolve()
    let rateStart = Date.now()
    let rateCount = 0
    let joinAttempts = 0
    // Checks shared by every event: payload shape, joined room, and server-side identity.
    const authorize = (event, payload) => {
      const data = plainObject(payload)
      identifier(data.boardId, 'board id')
      if (event !== 'JOIN_BOARD') {
        if (hasLeft || currentRoom !== data.boardId || !socket.rooms.has(currentRoom)
          || sessionSockets.get(`${currentRoom}:${currentSession?.sessionId}`) !== socket.id) {
          throw badRequest('Join this board before sending events')
        }
        if (MUTATING_EVENTS.has(event) && sessionRoles.get(`${currentRoom}:${currentSession.sessionId}`) === 'viewer') {
          throw badRequest('You have view-only access to this board')
        }
        // Identity comes from the joined session, never client-controlled payloads.
        data.sessionId = currentSession.sessionId
        if (event !== 'UPDATE_USERNAME') data.username = currentSession.username
        data.color = currentSession.color
      }
      return data
    }

    const on = (event, handler) => socket.on(event, (payload) => {
      if (Date.now() - rateStart > 10000) { rateStart = Date.now(); rateCount = 0; joinAttempts = 0 }
      if (++rateCount > 2000 || (event === 'JOIN_BOARD' && ++joinAttempts > 10)) {
        socket.emit('OPERATION_ERROR', { message: 'Too many events; slow down' })
        return
      }
      if (EPHEMERAL_EVENTS.has(event)) {
        // Invalid cursor/laser frames are dropped silently; not worth an error round-trip.
        try { handler(authorize(event, payload)) } catch { /* ignore */ }
        return
      }
      chain = chain.then(async () => {
        if (event === 'disconnect') return handler(payload)
        const data = authorize(event, payload)
        return inRoom(data.boardId, async () => {
          if (MUTATING_EVENTS.has(event) && !(await Board.exists({ roomId: data.boardId }))) throw badRequest('Board no longer exists')
          await handler(data)
        })
      }).catch(err => {
        if (!err.status) console.error(`[${event}]`, err.message)
        socket.emit(event === 'JOIN_BOARD' ? 'JOIN_ERROR' : 'OPERATION_ERROR', {
          message: err.status ? err.message : 'Operation failed; please reconnect and retry',
        })
      })
    })

    // JOIN_BOARD
    on('JOIN_BOARD', async (data) => {
      const { boardId, sessionId, username, color, boardPassword, sessionToken } = data
      identifier(sessionId, 'session id')
      const resumeTokenHash = hashSessionToken(sessionToken)
      if (!resumeTokenHash) throw badRequest('Invalid session token')
      if (typeof username !== 'string' || username.length > 80 || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw badRequest('Invalid participant details')
      const existing = await Session.findOne({ boardId, sessionId }).select('+resumeTokenHash').lean()
      if (existing && existing.resumeTokenHash !== resumeTokenHash) throw badRequest('Session belongs to another participant')
      const resolvedUsername = socket.data.authName || username
      const userId = socket.data.authUid || null

      const board = await Board.findOne({ roomId: boardId }).select('+editLinkToken')
      if (!board) {
        socket.emit('JOIN_ERROR', { message: 'Board not found' })
        return
      }

      const access = await canAccessBoard(board, { userId, password: boardPassword, sessionId, sessionToken, clientKey: clientAddress(socket) })
      if (!access.allowed) {
        const messages = {
          auth: 'Sign in required to join this board',
          locked: 'This board is locked — no new participants allowed',
          rate_limited: 'Too many wrong passwords; try again later',
          password: 'Incorrect board password',
        }
        socket.emit('JOIN_ERROR', { message: messages[access.reason] || messages.password, reason: access.reason })
        return
      }

      if (currentRoom && currentRoom !== boardId && currentSession) {
        await handleLeave(socket, io, currentRoom, currentSession)
      }
      // One live session per signed-in user per board (drops stale tabs/refreshes)
      await removeDuplicateSessions(io, boardId, userId, resolvedUsername, sessionId)

      const alreadyInRoom =
        currentRoom === boardId &&
        currentSession?.sessionId === sessionId &&
        socket.rooms.has(boardId)

      currentRoom = boardId
      const viaEditLink = matchesEditLink(board, data.editLink) || Boolean(existing?.viaEditLink)
      const hostRole = existing?.hostRole || null
      const role = participantRole(board, { userId, hostRole, viaEditLink })
      currentSession = { sessionId, username: resolvedUsername, color }
      sessionRoles.set(`${boardId}:${sessionId}`, role)
      hasLeft = false
      socketRegistry.set(socket.id, { boardId, sessionId })
      sessionSockets.set(`${boardId}:${sessionId}`, socket.id)

      socket.join(boardId)

      await Session.findOneAndUpdate(
        { sessionId, boardId },
        {
          sessionId,
          boardId,
          userId,
          resumeTokenHash,
          username: resolvedUsername,
          color,
          lastHeartbeat: new Date(),
          role,
          hostRole,
          viaEditLink,
        },
        { upsert: true, new: true },
      )
      await markJoin(boardId, { sessionId, userId, username: resolvedUsername })

      if (!roomCursors.has(boardId)) {
        roomCursors.set(boardId, new Map())
      }

      await Board.updateOne({ roomId: boardId }, { emptySince: null })
      const [elements, users, chat] = await Promise.all([
        Element.find({ boardId }).lean(),
        getBoardUsers(io, boardId),
        recentChat(boardId),
      ])

      socket.emit('BOARD_STATE', { elements, users, boardId, chat, role, linkAccess: board.linkAccess || 'edit' })

      const activeSharer = getScreenSharer(boardId)
      if (activeSharer && activeSharer.sessionId !== sessionId) {
        socket.emit('SCREEN_SHARE_START', activeSharer)
        relayToSession(io, boardId, activeSharer.sessionId, 'SCREEN_SHARE_VIEWER_JOINED', {
          viewerSessionId: sessionId,
        })
      }

      if (!alreadyInRoom) {
        socket.to(boardId).emit('USER_JOINED', { username: resolvedUsername, color })
        io.to(boardId).emit('ACTIVITY_EVENT', activity('join', `${resolvedUsername} joined the board`, currentSession))
      }

      io.to(boardId).emit('PRESENCE_UPDATE', users)
    })
    on('LEAVE_BOARD', async (data) => {
      if (hasLeft) return
      hasLeft = true
      await handleLeave(socket, io, data?.boardId || currentRoom, currentSession)
    })

    // CURSOR_MOVE
    on('CURSOR_MOVE', (data) => {
      const { boardId, sessionId, username, color, x, y } = data
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      const cursors = roomCursors.get(boardId)
      if (cursors) {
        cursors.set(sessionId, { sessionId, username, color, x, y })
        // Broadcast all cursors to room
        socket.to(boardId).emit('CURSORS_UPDATE', Array.from(cursors.values()))
      }
    })

    // ADD_ELEMENT — emit first, persist async
    on('ADD_ELEMENT', async (data) => {
      const { boardId } = data
      const element = { ...canvasFields(data.element, true), boardId, createdBy: socket.data.authUid || currentSession.sessionId }
      // Persist first (ordered by the room queue), then broadcast exactly what was stored.
      await Element.updateOne({ id: element.id, boardId }, { $setOnInsert: element }, { upsert: true, runValidators: true })
      socket.to(boardId).emit('ADD_ELEMENT', element)
      io.to(boardId).emit('ACTIVITY_EVENT', activity('add', `${currentSession.username} added a ${element.type}`, currentSession))
      touchBoardMeta(boardId, socket, currentSession?.username)
    })

    // UPDATE_ELEMENT — emit first, persist async
    on('UPDATE_ELEMENT', async (data) => {
      const { boardId, elementId } = data
      identifier(elementId, 'element id')
      const changes = canvasFields(data.changes)
      if (!Object.keys(changes).length) return
      await Element.updateOne({ id: elementId, boardId }, { $set: changes }, { runValidators: true })
      socket.to(boardId).emit('UPDATE_ELEMENT', { elementId, changes })
      touchBoardMeta(boardId, socket, currentSession?.username)
    })

    // DELETE_ELEMENT — emit first, persist async
    on('DELETE_ELEMENT', async (data) => {
      const { boardId, elementId } = data
      identifier(elementId, 'element id')
      const { deletedCount } = await Element.deleteOne({ id: elementId, boardId })
      if (!deletedCount) return
      socket.to(boardId).emit('DELETE_ELEMENT', { elementId })
      io.to(boardId).emit('ACTIVITY_EVENT', activity('delete', `${currentSession.username} deleted an element`, currentSession))
      touchBoardMeta(boardId, socket, currentSession?.username)
    })

    // CLEAR_BOARD
    on('CLEAR_BOARD', async (data) => {
      const { boardId } = data
      await Element.deleteMany({ boardId })
      socket.to(boardId).emit('CLEAR_BOARD')
      touchBoardMeta(boardId, socket, currentSession.username)
      io.to(boardId).emit('ACTIVITY_EVENT', activity('clear', `${currentSession.username} cleared the board`, currentSession))
    })

    // ACTIVITY_EVENT
    on('ACTIVITY_EVENT', (data) => {
      const { boardId, event } = data
      if (!event || typeof event.message !== 'string' || !event.message || event.message.length > 500) throw badRequest('Invalid activity event')
      const type = typeof event.type === 'string' && event.type.length <= 32 ? event.type : 'info'
      // Only whitelisted fields are relayed; the server stamps id, author and time.
      socket.to(boardId).emit('ACTIVITY_EVENT', activity(type, event.message, currentSession))
    })

    // UPDATE_USERNAME — update session record and broadcast new presence
    on('UPDATE_USERNAME', async (data) => {
      const { boardId, sessionId, username } = data
      if (typeof username !== 'string' || !username.trim() || username.length > 80) throw badRequest('Invalid username')
      try {
        // Update session in DB
        await Session.findOneAndUpdate(
          { sessionId, boardId },
          { username }
        )
        // Update local session reference
        if (currentSession && currentSession.sessionId === sessionId) {
          currentSession.username = username
        }
        // Broadcast updated user list to all users in the room
        const users = await getBoardUsers(io, boardId)
        io.to(boardId).emit('PRESENCE_UPDATE', users)
      } catch (err) {
        console.error('[UPDATE_USERNAME]', err)
      }
    })

    // CHAT_MESSAGE — live chat
    on('CHAT_MESSAGE', async (data) => {
      const { boardId, message, mentions } = data
      if (typeof message !== 'string' || !message.trim() || message.length > 4000) throw badRequest('Invalid chat message')
      if (mentions !== undefined && (!Array.isArray(mentions) || mentions.length > 50)) throw badRequest('Invalid mentions')
      const safeMentions = (mentions || []).filter(m => m && typeof m.sessionId === 'string' && m.sessionId.length <= 128)
        .map(m => ({ sessionId: m.sessionId, username: typeof m.username === 'string' ? m.username.slice(0, 80) : '' }))
      // Persist first so history is complete for anyone who joins later.
      const saved = await ChatMessage.create({
        id: randomUUID(),
        boardId,
        sessionId: currentSession.sessionId,
        userId: socket.data.authUid || null,
        username: currentSession.username,
        color: currentSession.color,
        message,
        mentions: safeMentions,
        reactions: [],
      })
      io.to(boardId).emit('CHAT_MESSAGE', publicChatMessage(saved))
      void trimChat(boardId)

      if (safeMentions.length) {
        for (const m of safeMentions) {
          emitToBoardSession(io, boardId, m.sessionId, 'MENTION_NOTIFY', {
            message,
            from: currentSession?.username || 'User',
            boardId,
          })
        }
      }
    })

    // HEARTBEAT
    on('HEARTBEAT', async (data) => {
      const { boardId, sessionId } = data
      try {
        const update = { lastHeartbeat: new Date() }
        if (socket.data.authUid) update.userId = socket.data.authUid
        if (socket.data.authName) update.username = socket.data.authName
        await Session.findOneAndUpdate({ sessionId, boardId }, update)
        await touch(boardId, sessionId)
      } catch (err) {
        console.error('[HEARTBEAT]', err)
      }
    })

    // Undo/redo carries conditional patches, never a destructive full-board snapshot.
    on('SYNC_STATE', async (data) => {
      const { boardId, patches } = data
      if (!Array.isArray(patches) || patches.length > 500) throw badRequest('Invalid history operation')
      const safe = patches.map(patch => {
        plainObject(patch)
        const id = identifier(patch.id)
        return { id, before: patch.before ? { ...canvasFields(patch.before, true), id } : null,
          after: patch.after ? { ...canvasFields(patch.after, true), id, boardId } : null }
      })
      const before = await Element.find({ boardId }).lean()
      const after = applyPatches(before, safe)
      for (const patch of diffElements(before, after)) {
        if (!patch.after) await Element.deleteOne({ boardId, id: patch.id })
        else await Element.replaceOne({ boardId, id: patch.id }, { ...canvasFields(patch.after, true), boardId }, { upsert: true, runValidators: true })
      }
      const elements = await Element.find({ boardId }).lean()
      io.to(boardId).emit('SYNC_STATE', { elements })
      touchBoardMeta(boardId, socket, currentSession?.username)
    })

    // ── Voice / Video signaling ──
    on('CALL_JOIN', async (data) => {
      const { boardId, sessionId, username, color, audioEnabled, videoEnabled } = data
      const map = getCallMap(boardId)
      const participants = Array.from(map.entries())
        .filter(([id]) => id !== sessionId)
        .map(([id, p]) => ({
          sessionId: id,
          username: p.username,
          color: p.color,
          audioEnabled: p.audio,
          videoEnabled: p.video,
        }))

      map.set(sessionId, {
        socketId: socket.id,
        username: username || currentSession?.username || 'User',
        color: color || currentSession?.color || '#6366F1',
        audio: audioEnabled ?? false,
        video: videoEnabled ?? false,
      })
      sessionSockets.set(`${boardId}:${sessionId}`, socket.id)

      await markCallJoin(boardId, sessionId)
      socket.emit('CALL_PARTICIPANTS', { participants })
      socket.to(boardId).emit('USER_CALL_JOINED', {
        sessionId,
        username: username || currentSession?.username || 'User',
        color: color || currentSession?.color || '#6366F1',
        audioEnabled: audioEnabled ?? false,
        videoEnabled: videoEnabled ?? false,
      })
    })

    on('CALL_LEAVE', (data) => {
      const { boardId, sessionId } = data
      leaveCall(io, boardId, sessionId)
    })

    on('MEDIA_STATE', (data) => {
      const { boardId, sessionId } = data
      const audioEnabled = Boolean(data.audioEnabled), videoEnabled = Boolean(data.videoEnabled)
      const peer = getCallMap(boardId).get(sessionId)
      if (peer) {
        peer.audio = audioEnabled
        peer.video = videoEnabled
      }
      socket.to(boardId).emit('MEDIA_STATE', {
        sessionId,
        audioEnabled,
        videoEnabled,
        username: currentSession?.username,
        color: currentSession?.color,
      })
    })

    on('WEBRTC_OFFER', (data) => {
      const { boardId } = data
      const targetSessionId = identifier(data.targetSessionId, 'target session')
      relayToSession(io, boardId, targetSessionId, 'WEBRTC_OFFER', {
        fromSessionId: data.sessionId,
        offer: signal(data.offer, 'offer'),
      })
    })

    on('WEBRTC_ANSWER', (data) => {
      const { boardId } = data
      const targetSessionId = identifier(data.targetSessionId, 'target session')
      relayToSession(io, boardId, targetSessionId, 'WEBRTC_ANSWER', {
        fromSessionId: data.sessionId,
        answer: signal(data.answer, 'answer'),
      })
    })

    on('ICE_CANDIDATE', (data) => {
      const { boardId } = data
      const targetSessionId = identifier(data.targetSessionId, 'target session')
      relayToSession(io, boardId, targetSessionId, 'ICE_CANDIDATE', {
        fromSessionId: data.sessionId,
        candidate: signal(data.candidate, 'candidate'),
      })
    })

    // ── Laser pointer ──
    on('LASER_POINTER', (data) => {
      const { boardId, x, y } = data
      if (!finite(x) || !finite(y)) return
      socket.to(boardId).volatile.emit('LASER_POINTER', {
        sessionId: currentSession?.sessionId,
        username: currentSession?.username,
        color: currentSession?.color,
        x, y,
      })
    })

    // ── Canvas reaction ──
    on('CANVAS_REACTION', (data) => {
      const { boardId, x, y } = data
      if (!finite(x) || !finite(y)) throw badRequest('Invalid reaction position')
      const emoji = shortString(data.emoji, 'emoji', 16)
      io.to(boardId).emit('CANVAS_REACTION', {
        id: randomUUID(),
        sessionId: currentSession?.sessionId,
        username: currentSession?.username,
        x, y, emoji,
      })
    })

    // ── Chat reaction ──
    on('CHAT_REACTION', async (data) => {
      const { boardId } = data
      const messageId = shortString(data.messageId, 'message id', 64)
      const emoji = shortString(data.emoji, 'emoji', 16)
      const sessionId = currentSession.sessionId
      const saved = await ChatMessage.findOne({ boardId, id: messageId })
      let reactions
      if (saved) {
        // Server-side toggle; everyone (including the sender) receives the authoritative list.
        const list = saved.reactions.map(r => ({ emoji: r.emoji, sessionIds: [...r.sessionIds] }))
        const entry = list.find(r => r.emoji === emoji)
        if (!entry) {
          if (list.length >= 20) throw badRequest('Too many different reactions on this message')
          list.push({ emoji, sessionIds: [sessionId] })
        } else if (entry.sessionIds.includes(sessionId)) {
          entry.sessionIds = entry.sessionIds.filter(id => id !== sessionId)
        } else {
          entry.sessionIds.push(sessionId)
        }
        saved.reactions = list.filter(r => r.sessionIds.length)
        await saved.save()
        reactions = saved.reactions.map(r => ({ emoji: r.emoji, sessionIds: [...r.sessionIds] }))
      }
      io.to(boardId).emit('CHAT_REACTION', { messageId, emoji, sessionId, username: currentSession.username, reactions })
    })

    // ── Clear chat: board owner only (or anyone on a board without an owner) ──
    on('CHAT_CLEAR', async (data) => {
      const { boardId } = data
      const board = await Board.findOne({ roomId: boardId }, { ownerUid: 1 }).lean()
      if (board?.ownerUid && board.ownerUid !== socket.data.authUid) throw badRequest('Only the board owner can clear the chat')
      await ChatMessage.deleteMany({ boardId })
      io.to(boardId).emit('CHAT_CLEARED', { by: currentSession.username })
    })

    on('CHAT_TYPING', (data) => {
      const { boardId, typing } = data
      if (!boardId || !currentSession?.sessionId) return
      socket.to(boardId).volatile.emit('CHAT_TYPING', {
        sessionId: currentSession.sessionId,
        username: currentSession.username,
        typing: Boolean(typing),
      })
    })

    on('USER_DRAWING', (data) => {
      const { boardId, drawing } = data
      if (!boardId || !currentSession?.sessionId) return
      socket.to(boardId).volatile.emit('USER_DRAWING', {
        sessionId: currentSession.sessionId,
        username: currentSession.username,
        drawing: Boolean(drawing),
      })
    })

    on('KICK_USER', async (data) => {
      const { boardId } = data
      const targetSessionId = identifier(data.targetSessionId, 'target session')
      if (!(await isBoardOwner(boardId, socket.data.authUid))) throw badRequest('Only the board owner can remove participants')

      const targetSid = sessionSockets.get(`${boardId}:${targetSessionId}`)
      if (!targetSid) return

      io.to(targetSid).emit('KICKED_FROM_BOARD', { message: 'Removed by the board host' })
      const targetSocket = io.sockets.sockets.get(targetSid)
      const targetSession = await Session.findOne({ boardId, sessionId: targetSessionId }).lean()
      if (targetSocket && targetSession) {
        await handleLeave(targetSocket, io, boardId, {
          sessionId: targetSessionId,
          username: targetSession.username,
          color: targetSession.color,
        })
        targetSocket.disconnect(true)
      }
    })

    // Host changes one participant between editor and viewer, live.
    on('SET_ROLE', async (data) => {
      const { boardId } = data
      const targetSessionId = identifier(data.targetSessionId, 'target session')
      if (!ROLES.includes(data.role)) throw badRequest('Invalid role')
      if (!(await isBoardOwner(boardId, socket.data.authUid))) throw badRequest('Only the board owner can change access')
      const target = await Session.findOne({ boardId, sessionId: targetSessionId }).lean()
      if (!target) throw badRequest('Participant not found')
      const board = await Board.findOne({ roomId: boardId }).lean()
      if (target.userId && target.userId === board.ownerUid) throw badRequest('The board owner always has edit access')
      await Session.updateOne({ boardId, sessionId: targetSessionId }, { hostRole: data.role, role: data.role })
      if (sessionRoles.has(`${boardId}:${targetSessionId}`)) sessionRoles.set(`${boardId}:${targetSessionId}`, data.role)
      relayToSession(io, boardId, targetSessionId, 'ROLE_UPDATED', { role: data.role, by: currentSession?.username })
      io.to(boardId).emit('ACTIVITY_EVENT', activity('rename', `${target.username} can now ${data.role === 'viewer' ? 'only view' : 'edit'} the board`, currentSession))
      io.to(boardId).emit('PRESENCE_UPDATE', await getBoardUsers(io, boardId))
    })

    on('MUTE_USER', async (data) => {
      const { boardId } = data
      const targetSessionId = identifier(data.targetSessionId, 'target session')
      if (!(await isBoardOwner(boardId, socket.data.authUid))) throw badRequest('Only the board owner can mute participants')

      relayToSession(io, boardId, targetSessionId, 'FORCE_MUTE', {})
      io.to(boardId).emit('USER_MUTED', {
        sessionId: targetSessionId,
        muted: true,
        by: currentSession?.username,
      })
    })

    // ── Screen share signaling ──
    on('SCREEN_SHARE_START', async (data) => {
      const { boardId } = data
      const sessionId = currentSession?.sessionId
      if (getScreenSharer(boardId) && getScreenSharer(boardId).sessionId !== sessionId) throw badRequest('Another participant is already sharing')
      screenSharers.set(boardId, {
        sessionId,
        username: currentSession?.username || 'User',
      })

      const allUsers = await getBoardUsers(io, boardId)
      const viewers = allUsers.filter((u) => u.sessionId !== sessionId)
      socket.emit('SCREEN_SHARE_VIEWERS', { viewers: viewers.map((v) => v.sessionId) })

      socket.to(boardId).emit('SCREEN_SHARE_START', {
        sessionId,
        username: currentSession?.username,
      })
    })

    on('SCREEN_SHARE_STOP', (data) => {
      const { boardId, sessionId } = data
      const sharer = getScreenSharer(boardId)
      if (sharer?.sessionId === sessionId) {
        screenSharers.delete(boardId)
        io.to(boardId).emit('SCREEN_SHARE_STOP', { sessionId })
      }
    })

    on('SCREEN_SHARE_REQUEST_OFFER', (data) => {
      const { boardId } = data
      const viewerSessionId = currentSession?.sessionId
      const sharer = getScreenSharer(boardId)
      if (!sharer || !viewerSessionId || sharer.sessionId === viewerSessionId) return
      relayToSession(io, boardId, sharer.sessionId, 'SCREEN_SHARE_VIEWER_JOINED', {
        viewerSessionId,
      })
    })

    on('SCREEN_SHARE_OFFER', (data) => {
      const { boardId } = data
      const offer = signal(data.offer, 'offer')
      const targetSessionId = data.targetSessionId === undefined ? undefined : identifier(data.targetSessionId, 'target session')
      const fromSessionId = data.sessionId

      if (targetSessionId) {
        relayToSession(io, boardId, targetSessionId, 'SCREEN_SHARE_OFFER', {
          fromSessionId,
          offer,
        })
        return
      }

      const sharer = getScreenSharer(boardId)
      if (sharer) {
        relayToSession(io, boardId, sharer.sessionId, 'SCREEN_SHARE_OFFER', {
          fromSessionId,
          offer,
        })
      }
    })

    on('SCREEN_SHARE_ANSWER', (data) => {
      const { boardId } = data
      const targetSessionId = identifier(data.targetSessionId, 'target session')
      relayToSession(io, boardId, targetSessionId, 'SCREEN_SHARE_ANSWER', {
        fromSessionId: data.sessionId,
        answer: signal(data.answer, 'answer'),
      })
    })

    on('SCREEN_SHARE_ICE', (data) => {
      const { boardId } = data
      const targetSessionId = identifier(data.targetSessionId, 'target session')
      relayToSession(io, boardId, targetSessionId, 'SCREEN_SHARE_ICE', {
        fromSessionId: data.sessionId,
        candidate: signal(data.candidate, 'candidate'),
      })
    })

    // DISCONNECT
    on('disconnect', async () => {
      console.log(`[Socket] Disconnected: ${socket.id}`)
      cleanupSocketCall(io, socket.id)
      socketRegistry.delete(socket.id)
      if (currentRoom && currentSession && !hasLeft) {
        hasLeft = true
        await handleLeave(socket, io, currentRoom, currentSession)
      }
    })
  })
}

async function shouldDeleteBoard(boardId) {
  const board = await Board.findOne({ roomId: boardId }).lean()
  return !board?.persistent
}

async function handleLeave(socket, io, boardId, session) {
  if (!boardId || !session) return

  try {
    const activeSocketId = sessionSockets.get(`${boardId}:${session.sessionId}`)
    if (activeSocketId && activeSocketId !== socket.id) return
    // Close attendance first (atomic), then the call bookkeeping.
    await markLeave(boardId, session.sessionId)
    leaveCall(io, boardId, session.sessionId)
    socketRegistry.delete(socket.id)
    sessionSockets.delete(`${boardId}:${session.sessionId}`)
    sessionRoles.delete(`${boardId}:${session.sessionId}`)

    // Stop screen share if this user was sharing
    const sharer = getScreenSharer(boardId)
    if (sharer?.sessionId === session.sessionId) {
      screenSharers.delete(boardId)
      io.to(boardId).emit('SCREEN_SHARE_STOP', { sessionId: session.sessionId })
    }

    // Remove session
    // Retain the private resume token briefly so locked rooms can reconnect.
    await Session.updateOne({ sessionId: session.sessionId, boardId }, { lastHeartbeat: new Date() })

    // Remove cursor
    const cursors = roomCursors.get(boardId)
    if (cursors) {
      cursors.delete(session.sessionId)
      if (cursors.size === 0) roomCursors.delete(boardId)
    }

    socket.leave(boardId)

    // Notify others
    socket.to(boardId).emit('USER_LEFT', { username: session.username, color: session.color })

    // Check remaining sessions
    const remaining = [...sessionSockets.keys()].filter(key => key.startsWith(`${boardId}:`)).length

    if (remaining === 0) {
      await Board.updateOne({ roomId: boardId }, { emptySince: new Date() })
      roomCursors.delete(boardId)
      lastMetaWrite.delete(boardId)
      callParticipants.delete(boardId)
      screenSharers.delete(boardId)
    } else {
      const users = await getBoardUsers(io, boardId)
      io.to(boardId).emit('PRESENCE_UPDATE', users)
    }
  } catch (err) {
    console.error('[LEAVE]', err)
  }
}
