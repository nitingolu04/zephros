import { Board, Element, Session } from '../models/index.js'
import { verifyIdToken, isFirebaseConfigured } from '../lib/firebase.js'
import { canAccessBoard, isBoardOwner } from '../lib/boardAccess.js'

// In-memory cursor positions for performance
const roomCursors = new Map() // roomId -> Map<sessionId, cursorData>

// Voice/video call tracking
const callParticipants = new Map() // boardId -> Map<sessionId, { socketId, username, color, audio, video }>
const socketRegistry = new Map() // socketId -> { boardId, sessionId }
const sessionSockets = new Map() // `${boardId}:${sessionId}` -> socketId

// In-memory screen share state
const screenSharers = new Map() // boardId -> { sessionId, username }

function touchBoardMeta(boardId, socket, username) {
  const uid = socket.data?.authUid || null
  const displayName = socket.data?.authName || username || 'User'
  Board.findOneAndUpdate(
    { roomId: boardId },
    { lastEditedBy: { uid, displayName } },
  ).catch(() => {})
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
      if (name && normalizeUsername(k.username) === name) return true
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
  return dedupeSessions(await Session.find({ boardId }).lean())
}

async function removeDuplicateSessions(io, boardId, userId, username, keepSessionId) {
  const normalizedName = normalizeUsername(username)
  const orConditions = []
  if (userId) orConditions.push({ userId })
  if (normalizedName) {
    orConditions.push({
      username: { $regex: new RegExp(`^${escapeRegex(normalizedName)}$`, 'i') },
    })
  }
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

function leaveCall(io, boardId, sessionId) {
  const map = getCallMap(boardId)
  if (!map.has(sessionId)) return
  map.delete(sessionId)
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
    let hasLeft = false

    // JOIN_BOARD
    socket.on('JOIN_BOARD', async (data) => {
      const { boardId, sessionId, username, color, boardPassword } = data
      const resolvedUsername = socket.data.authName || username
      const userId = socket.data.authUid || null

      const board = await Board.findOne({ roomId: boardId })
      if (!board) {
        socket.emit('JOIN_ERROR', { message: 'Board not found' })
        return
      }

      const access = await canAccessBoard(board, { userId, password: boardPassword, sessionId })
      if (!access.allowed) {
        socket.emit('JOIN_ERROR', {
          message: access.reason === 'auth'
            ? 'Sign in required to join this board'
            : access.reason === 'locked'
              ? 'This board is locked — no new participants allowed'
              : 'Incorrect board password',
          reason: access.reason,
        })
        return
      }

      // One live session per signed-in user per board (drops stale tabs/refreshes)
      await removeDuplicateSessions(io, boardId, userId, resolvedUsername, sessionId)

      const alreadyInRoom =
        currentRoom === boardId &&
        currentSession?.sessionId === sessionId &&
        socket.rooms.has(boardId)

      currentRoom = boardId
      currentSession = { sessionId, username: resolvedUsername, color }
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
          username: resolvedUsername,
          color,
          lastHeartbeat: new Date(),
        },
        { upsert: true, new: true },
      )

      if (!roomCursors.has(boardId)) {
        roomCursors.set(boardId, new Map())
      }

      const elements = await Element.find({ boardId }).lean()
      const users = await getBoardUsers(io, boardId)

      socket.emit('BOARD_STATE', { elements, users })

      const activeSharer = getScreenSharer(boardId)
      if (activeSharer && activeSharer.sessionId !== sessionId) {
        socket.emit('SCREEN_SHARE_START', activeSharer)
        relayToSession(io, boardId, activeSharer.sessionId, 'SCREEN_SHARE_VIEWER_JOINED', {
          viewerSessionId: sessionId,
        })
      }

      if (!alreadyInRoom) {
        socket.to(boardId).emit('USER_JOINED', { username: resolvedUsername, color })
        io.to(boardId).emit('ACTIVITY_EVENT', {
          id: Date.now().toString(),
          message: `${resolvedUsername} joined the board`,
          username: resolvedUsername,
          color,
          timestamp: new Date().toISOString(),
          type: 'join',
        })
      }

      io.to(boardId).emit('PRESENCE_UPDATE', users)
    })
    socket.on('LEAVE_BOARD', async (data) => {
      if (hasLeft) return
      hasLeft = true
      await handleLeave(socket, io, data?.boardId || currentRoom, currentSession)
    })

    // CURSOR_MOVE
    socket.on('CURSOR_MOVE', (data) => {
      const { boardId, sessionId, username, color, x, y } = data
      const cursors = roomCursors.get(boardId)
      if (cursors) {
        cursors.set(sessionId, { sessionId, username, color, x, y })
        // Broadcast all cursors to room
        socket.to(boardId).emit('CURSORS_UPDATE', Array.from(cursors.values()))
      }
    })

    // ADD_ELEMENT — emit first, persist async
    socket.on('ADD_ELEMENT', (data) => {
      const { boardId, element } = data

      // Broadcast IMMEDIATELY (no await)
      socket.to(boardId).emit('ADD_ELEMENT', element)

      io.to(boardId).emit('ACTIVITY_EVENT', {
        id: Date.now().toString(),
        message: `${currentSession?.username || 'User'} added a ${element.type}`,
        username: currentSession?.username || 'User',
        color: currentSession?.color || '#6366F1',
        timestamp: new Date().toISOString(),
        type: 'add',
      })

      // Persist in background
      Element.create({ ...element, boardId }).catch(err => console.error('[ADD_ELEMENT]', err))
      touchBoardMeta(boardId, socket, currentSession?.username)
    })

    // UPDATE_ELEMENT — emit first, persist async
    socket.on('UPDATE_ELEMENT', (data) => {
      const { boardId, elementId, changes } = data

      // Broadcast IMMEDIATELY
      socket.to(boardId).emit('UPDATE_ELEMENT', { elementId, changes })

      // Persist in background
      Element.findOneAndUpdate({ id: elementId, boardId }, { $set: changes })
        .catch(err => console.error('[UPDATE_ELEMENT]', err))
      touchBoardMeta(boardId, socket, currentSession?.username)
    })

    // DELETE_ELEMENT — emit first, persist async
    socket.on('DELETE_ELEMENT', (data) => {
      const { boardId, elementId } = data

      // Broadcast IMMEDIATELY
      socket.to(boardId).emit('DELETE_ELEMENT', { elementId })

      io.to(boardId).emit('ACTIVITY_EVENT', {
        id: Date.now().toString(),
        message: `${currentSession?.username || 'User'} deleted an element`,
        username: currentSession?.username || 'User',
        color: currentSession?.color || '#6366F1',
        timestamp: new Date().toISOString(),
        type: 'delete',
      })

      // Persist in background
      Element.deleteOne({ id: elementId, boardId }).catch(err => console.error('[DELETE_ELEMENT]', err))
      touchBoardMeta(boardId, socket, currentSession?.username)
    })

    // CLEAR_BOARD
    socket.on('CLEAR_BOARD', async (data) => {
      const { boardId } = data
      try {
        await Element.deleteMany({ boardId })
        socket.to(boardId).emit('CLEAR_BOARD')
        touchBoardMeta(boardId, socket, currentSession?.username)

        io.to(boardId).emit('ACTIVITY_EVENT', {
          id: Date.now().toString(),
          message: `${currentSession?.username || 'User'} cleared the board`,
          username: currentSession?.username || 'User',
          color: currentSession?.color || '#6366F1',
          timestamp: new Date().toISOString(),
          type: 'clear',
        })
      } catch (err) {
        console.error('[CLEAR_BOARD]', err)
      }
    })

    // ACTIVITY_EVENT
    socket.on('ACTIVITY_EVENT', (data) => {
      const { boardId, event } = data
      socket.to(boardId).emit('ACTIVITY_EVENT', event)
    })

    // UPDATE_USERNAME — update session record and broadcast new presence
    socket.on('UPDATE_USERNAME', async (data) => {
      const { boardId, sessionId, username } = data
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
    socket.on('CHAT_MESSAGE', (data) => {
      const { boardId, message, mentions } = data
      io.to(boardId).emit('CHAT_MESSAGE', {
        id: Date.now().toString(),
        message,
        mentions: mentions || [],
        username: currentSession?.username || 'User',
        color: currentSession?.color || '#6366F1',
        sessionId: currentSession?.sessionId,
        timestamp: new Date().toISOString(),
        reactions: [],
      })

      if (mentions?.length) {
        for (const m of mentions) {
          emitToBoardSession(io, boardId, m.sessionId, 'MENTION_NOTIFY', {
            message,
            from: currentSession?.username || 'User',
            boardId,
          })
        }
      }
    })

    // HEARTBEAT
    socket.on('HEARTBEAT', async (data) => {
      const { boardId, sessionId } = data
      try {
        const update = { lastHeartbeat: new Date() }
        if (socket.data.authUid) update.userId = socket.data.authUid
        if (socket.data.authName) update.username = socket.data.authName
        await Session.findOneAndUpdate({ sessionId, boardId }, update)
      } catch (err) {
        console.error('[HEARTBEAT]', err)
      }
    })

    // SYNC_STATE — full state sync for undo/redo
    socket.on('SYNC_STATE', async (data) => {
      const { boardId, elements } = data
      try {
        // Replace all elements in DB
        await Element.deleteMany({ boardId })
        if (elements.length > 0) {
          await Element.insertMany(elements.map(el => ({ ...el, boardId })))
        }
        // Broadcast to other users
        socket.to(boardId).emit('SYNC_STATE', { elements })
      } catch (err) {
        console.error('[SYNC_STATE]', err)
      }
    })

    // ── Voice / Video signaling ──
    socket.on('CALL_JOIN', (data) => {
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

      socket.emit('CALL_PARTICIPANTS', { participants })
      socket.to(boardId).emit('USER_CALL_JOINED', {
        sessionId,
        username: username || currentSession?.username || 'User',
        color: color || currentSession?.color || '#6366F1',
        audioEnabled: audioEnabled ?? false,
        videoEnabled: videoEnabled ?? false,
      })
    })

    socket.on('CALL_LEAVE', (data) => {
      const { boardId, sessionId } = data
      leaveCall(io, boardId, sessionId)
    })

    socket.on('MEDIA_STATE', (data) => {
      const { boardId, sessionId, audioEnabled, videoEnabled } = data
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

    socket.on('WEBRTC_OFFER', (data) => {
      const { boardId, targetSessionId, offer } = data
      relayToSession(io, boardId, targetSessionId, 'WEBRTC_OFFER', {
        fromSessionId: data.sessionId || currentSession?.sessionId,
        offer,
      })
    })

    socket.on('WEBRTC_ANSWER', (data) => {
      const { boardId, targetSessionId, answer } = data
      relayToSession(io, boardId, targetSessionId, 'WEBRTC_ANSWER', {
        fromSessionId: data.sessionId || currentSession?.sessionId,
        answer,
      })
    })

    socket.on('ICE_CANDIDATE', (data) => {
      const { boardId, targetSessionId, candidate } = data
      relayToSession(io, boardId, targetSessionId, 'ICE_CANDIDATE', {
        fromSessionId: data.sessionId || currentSession?.sessionId,
        candidate,
      })
    })

    // ── Laser pointer ──
    socket.on('LASER_POINTER', (data) => {
      const { boardId, x, y } = data
      socket.to(boardId).emit('LASER_POINTER', {
        sessionId: currentSession?.sessionId,
        username: currentSession?.username,
        color: currentSession?.color,
        x, y,
      })
    })

    // ── Canvas reaction ──
    socket.on('CANVAS_REACTION', (data) => {
      const { boardId, x, y, emoji } = data
      io.to(boardId).emit('CANVAS_REACTION', {
        id: Date.now().toString(),
        sessionId: currentSession?.sessionId,
        username: currentSession?.username,
        x, y, emoji,
      })
    })

    // ── Chat reaction ──
    socket.on('CHAT_REACTION', (data) => {
      const { boardId, messageId, emoji } = data
      io.to(boardId).emit('CHAT_REACTION', {
        messageId,
        emoji,
        sessionId: currentSession?.sessionId,
        username: currentSession?.username,
      })
    })

    socket.on('CHAT_TYPING', (data) => {
      const { boardId, typing } = data
      if (!boardId || !currentSession?.sessionId) return
      socket.to(boardId).volatile.emit('CHAT_TYPING', {
        sessionId: currentSession.sessionId,
        username: currentSession.username,
        typing: Boolean(typing),
      })
    })

    socket.on('USER_DRAWING', (data) => {
      const { boardId, drawing } = data
      if (!boardId || !currentSession?.sessionId) return
      socket.to(boardId).volatile.emit('USER_DRAWING', {
        sessionId: currentSession.sessionId,
        username: currentSession.username,
        drawing: Boolean(drawing),
      })
    })

    socket.on('KICK_USER', async (data) => {
      const { boardId, targetSessionId } = data
      if (!boardId || !targetSessionId) return
      if (!(await isBoardOwner(boardId, socket.data.authUid))) return

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
      }
    })

    socket.on('MUTE_USER', async (data) => {
      const { boardId, targetSessionId } = data
      if (!boardId || !targetSessionId) return
      if (!(await isBoardOwner(boardId, socket.data.authUid))) return

      relayToSession(io, boardId, targetSessionId, 'FORCE_MUTE', {})
      io.to(boardId).emit('USER_MUTED', {
        sessionId: targetSessionId,
        muted: true,
        by: currentSession?.username,
      })
    })

    // ── Screen share signaling ──
    socket.on('SCREEN_SHARE_START', async (data) => {
      const { boardId } = data
      const sessionId = currentSession?.sessionId
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

    socket.on('SCREEN_SHARE_STOP', (data) => {
      const { boardId } = data
      const sessionId = data.sessionId || currentSession?.sessionId
      const sharer = getScreenSharer(boardId)
      if (sharer?.sessionId === sessionId) {
        screenSharers.delete(boardId)
        io.to(boardId).emit('SCREEN_SHARE_STOP', { sessionId })
      }
    })

    socket.on('SCREEN_SHARE_REQUEST_OFFER', (data) => {
      const { boardId } = data
      const viewerSessionId = currentSession?.sessionId
      const sharer = getScreenSharer(boardId)
      if (!sharer || !viewerSessionId || sharer.sessionId === viewerSessionId) return
      relayToSession(io, boardId, sharer.sessionId, 'SCREEN_SHARE_VIEWER_JOINED', {
        viewerSessionId,
      })
    })

    socket.on('SCREEN_SHARE_OFFER', (data) => {
      const { boardId, offer, targetSessionId } = data
      const fromSessionId = data.sessionId || currentSession?.sessionId

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

    socket.on('SCREEN_SHARE_ANSWER', (data) => {
      const { boardId, targetSessionId, answer } = data
      relayToSession(io, boardId, targetSessionId, 'SCREEN_SHARE_ANSWER', {
        fromSessionId: data.sessionId || currentSession?.sessionId,
        answer,
      })
    })

    socket.on('SCREEN_SHARE_ICE', (data) => {
      const { boardId, targetSessionId, candidate } = data
      relayToSession(io, boardId, targetSessionId, 'SCREEN_SHARE_ICE', {
        fromSessionId: data.sessionId || currentSession?.sessionId,
        candidate,
      })
    })

    // DISCONNECT
    socket.on('disconnect', async () => {
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
    leaveCall(io, boardId, session.sessionId)
    socketRegistry.delete(socket.id)
    sessionSockets.delete(`${boardId}:${session.sessionId}`)

    // Stop screen share if this user was sharing
    const sharer = getScreenSharer(boardId)
    if (sharer?.sessionId === session.sessionId) {
      screenSharers.delete(boardId)
      io.to(boardId).emit('SCREEN_SHARE_STOP', { sessionId: session.sessionId })
    }

    // Remove session
    await Session.deleteOne({ sessionId: session.sessionId, boardId })

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
    const remaining = await Session.countDocuments({ boardId })

    if (remaining === 0) {
      const deleteBoard = await shouldDeleteBoard(boardId)
      if (deleteBoard) {
        console.log(`[Cleanup] Last user left board ${boardId}. Deleting...`)
        await Board.deleteOne({ roomId: boardId })
        await Element.deleteMany({ boardId })
        await Session.deleteMany({ boardId })
        roomCursors.delete(boardId)
        callParticipants.delete(boardId)
        screenSharers.delete(boardId)
        io.to(boardId).emit('BOARD_DELETED')
      } else {
        console.log(`[Cleanup] Last user left board ${boardId}. Board is saved — keeping data.`)
        roomCursors.delete(boardId)
        callParticipants.delete(boardId)
        screenSharers.delete(boardId)
      }
    } else {
      const users = await getBoardUsers(io, boardId)
      io.to(boardId).emit('PRESENCE_UPDATE', users)
    }
  } catch (err) {
    console.error('[LEAVE]', err)
  }
}
