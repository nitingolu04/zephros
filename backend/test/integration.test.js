import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { io as client } from 'socket.io-client'
import { createApp } from '../src/app.js'
import { Attendance, Board, BoardVersion, ChatMessage, Element, Session } from '../src/models/index.js'
import { markCallLeave, markLeave } from '../src/lib/attendance.js'
import { autoSnapshotActiveBoards } from '../src/lib/versions.js'
import { hashBoardPassword, verifyBoardPassword, participantRole, hashSessionToken } from '../src/lib/boardAccess.js'
import { refreshRoles } from '../src/socket/handler.js'
import { readFileSync } from 'node:fs'
import { applyPatches, diffElements } from '../src/lib/canvasHistory.js'
import { cleanupExpiredBoards } from '../src/jobs/cleanup.js'

let mongo, server, io, base
const sockets = []
const event = (socket, name) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(name, done); reject(new Error(`Timeout: ${name}`)) }, 5000)
  const done = value => { clearTimeout(timer); resolve(value) }
  socket.once(name, done)
})
async function connect() {
  const socket = client(base, { transports: ['websocket'], reconnection: false })
  sockets.push(socket)
  await event(socket, 'connect')
  return socket
}
async function request(path, options = {}) {
  const response = await fetch(`${base}/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })
  return { status: response.status, data: await response.json() }
}
async function board(settings = {}) {
  return Board.create({ roomId: randomUUID(), title: 'Test', ...settings })
}
async function join(socket, roomId, extra = {}) {
  const credentials = { boardId: roomId, sessionId: randomUUID(), sessionToken: randomUUID(), username: 'Student', color: '#123456', ...extra }
  const ready = event(socket, 'BOARD_STATE')
  socket.emit('JOIN_BOARD', credentials)
  const state = await ready
  return { credentials, state }
}
const shape = (id = randomUUID()) => ({ id, type: 'rectangle', x: 10, y: 20, width: 100, height: 100 })

before(async () => {
  for (const key of ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']) delete process.env[key]
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  const created = createApp()
  server = created.httpServer
  io = created.io
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
}, { timeout: 180000 })

after(async () => {
  sockets.forEach(socket => socket.disconnect())
  if (io) await new Promise(resolve => io.close(resolve))
  // Let server-side disconnect handlers finish their writes before Mongo closes.
  await new Promise(resolve => setTimeout(resolve, 300))
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
})

test('health, guest creation and malformed API requests return JSON', async () => {
  assert.equal((await request('/health')).status, 200)
  assert.equal((await request('/board/create', { method: 'POST', body: JSON.stringify({ title: 'Demo' }) })).status, 201)
  assert.equal((await request('/board/create', { method: 'POST', body: '{' })).status, 400)
  assert.equal((await request('/missing')).status, 404)
  assert.equal((await request('/board/create', { method: 'POST', body: JSON.stringify({ title: { $ne: null } }) })).status, 400)
})

test('unconfigured Firebase never grants privileged account routes', async () => {
  assert.equal((await request('/auth/me')).status, 503)
  const b = await board()
  assert.equal((await request(`/board/${b.roomId}`, { method: 'DELETE' })).status, 503)
  assert.equal((await request(`/board/${b.roomId}`, { method: 'PATCH', body: JSON.stringify({ persistent: true }) })).status, 401)
})

test('private boards cannot be exported, renamed, duplicated or written through bypass routes', async () => {
  const b = await board({ accessPasswordHash: await hashBoardPassword('secret') })
  assert.equal((await request(`/board/${b.roomId}/export/json`)).status, 403)
  assert.equal((await request(`/board/${b.roomId}`, { method: 'PATCH', body: JSON.stringify({ title: 'Attack' }) })).status, 403)
  assert.notEqual((await request(`/board/${b.roomId}/duplicate`, { method: 'POST' })).status, 200)
  assert.equal((await request('/board/save', { method: 'POST', body: JSON.stringify({ boardId: b.roomId, elements: [shape()] }) })).status, 410)
  const exported = await request(`/board/${b.roomId}/export/json`, { headers: { 'X-Board-Password': 'secret' } })
  assert.equal(exported.status, 200)
  assert.equal(exported.data.board.accessPasswordHash, undefined)
})

test('unjoined sockets and cross-board writes are rejected', async () => {
  const socket = await connect(), a = await board(), b = await board()
  let denied = event(socket, 'OPERATION_ERROR')
  socket.emit('ADD_ELEMENT', { boardId: a.roomId, element: shape() })
  await denied
  await join(socket, a.roomId)
  denied = event(socket, 'OPERATION_ERROR')
  socket.emit('CLEAR_BOARD', { boardId: b.roomId })
  await denied
  assert.equal(await Element.countDocuments({ boardId: a.roomId }), 0)
})

test('same-name guests remain distinct; ordered writes persist and broadcast', async () => {
  const a = await connect(), b = await connect(), room = await board()
  await join(a, room.roomId)
  const second = await join(b, room.roomId)
  assert.equal(second.state.users.length, 2)
  assert.ok(second.state.users.every(user => !user.resumeTokenHash))
  const el = shape()
  const updated = event(b, 'UPDATE_ELEMENT')
  a.emit('ADD_ELEMENT', { boardId: room.roomId, element: el })
  a.emit('UPDATE_ELEMENT', { boardId: room.roomId, elementId: el.id, changes: { x: 55, boardId: 'other', id: 'spoofed' } })
  await updated
  const saved = await Element.findOne({ boardId: room.roomId, id: el.id }).lean()
  assert.equal(saved.x, 55)
  assert.equal(saved.boardId, room.roomId)
})

test('invalid socket input is rejected without killing the connection', async () => {
  const socket = await connect(), room = await board()
  await join(socket, room.roomId)
  const denied = event(socket, 'OPERATION_ERROR')
  socket.emit('ADD_ELEMENT', { boardId: room.roomId, element: { ...shape(), width: -5 } })
  await denied
  assert.equal(socket.connected, true)
  assert.equal(await Element.countDocuments({ boardId: room.roomId }), 0)
})

test('temporary board and content survive last participant reload', async () => {
  const socket = await connect(), room = await board()
  const { credentials } = await join(socket, room.roomId)
  await Element.create({ ...shape(), boardId: room.roomId })
  socket.emit('LEAVE_BOARD', { boardId: room.roomId })
  // The next JOIN is ordered after LEAVE on the same connection.
  const { state } = await join(socket, room.roomId, credentials)
  assert.equal(state.elements.length, 1)
  assert.ok(await Board.exists({ roomId: room.roomId }))
})

test('locked reconnect requires private token, not a publicly visible session ID', async () => {
  const socket = await connect(), attacker = await connect(), room = await board()
  const { credentials } = await join(socket, room.roomId)
  await Board.updateOne({ roomId: room.roomId }, { isLocked: true })
  const denied = event(attacker, 'JOIN_ERROR')
  attacker.emit('JOIN_BOARD', { ...credentials, sessionToken: randomUUID() })
  await denied
  const rejoined = await join(socket, room.roomId, credentials)
  assert.equal(rejoined.state.boardId, room.roomId)
})

test('undo patches preserve another participant element and unrelated field edits', async () => {
  const socket = await connect(), room = await board()
  await join(socket, room.roomId)
  const before = shape(), after = { ...before, x: 50 }, other = shape()
  await Element.insertMany([{ ...after, y: 99, boardId: room.roomId }, { ...other, boardId: room.roomId }])
  const synced = event(socket, 'SYNC_STATE')
  socket.emit('SYNC_STATE', { boardId: room.roomId, patches: diffElements([after], [before]) })
  const result = await synced
  assert.equal(result.elements.length, 2)
  const restored = result.elements.find(el => el.id === before.id)
  assert.equal(restored.x, 10)
  assert.equal(restored.y, 99)
  const rejected = event(socket, 'OPERATION_ERROR')
  socket.emit('SYNC_STATE', { boardId: room.roomId, elements: [] })
  await rejected
  assert.equal(await Element.countDocuments({ boardId: room.roomId }), 2)
})

test('undo does not overwrite a newer change to the same field', () => {
  const original = shape(), edited = { ...original, x: 50 }, remote = { ...edited, x: 80 }
  assert.equal(applyPatches([remote], diffElements([edited], [original]))[0].x, 80)
  assert.equal(applyPatches([remote], diffElements([edited], [])).length, 1)
})

test('cleanup deletes expired empty temporary boards but preserves saved and active boards', async () => {
  const expired = await board(), saved = await board({ persistent: true }), active = await board()
  const old = new Date(Date.now() - 180000)
  await Board.updateMany({ roomId: { $in: [expired.roomId, saved.roomId, active.roomId] } }, { updatedAt: old }, { timestamps: false })
  await Session.create({ boardId: active.roomId, sessionId: randomUUID(), username: 'Active', color: '#123456' })
  await cleanupExpiredBoards()
  assert.equal(await Board.exists({ roomId: expired.roomId }), null)
  assert.ok(await Board.exists({ roomId: saved.roomId }))
  assert.ok(await Board.exists({ roomId: active.roomId }))
})

test('password hashes have unique salts and verify correctly', async () => {
  const a = await hashBoardPassword('correct'), b = await hashBoardPassword('correct')
  assert.notEqual(a, b)
  assert.equal(await verifyBoardPassword('correct', a), true)
  assert.equal(await verifyBoardPassword('incorrect', a), false)
})

test('API responses carry security headers and a request id', async () => {
  const response = await fetch(`${base}/api/health`)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.ok(response.headers.get('x-request-id'))
  assert.equal((await response.json()).database, 'connected')
})

test('board passwords are brute-force limited per board', async () => {
  const b = await board({ accessPasswordHash: await hashBoardPassword('right') })
  const guess = password => request(`/board/${b.roomId}/verify-access`, { method: 'POST', body: JSON.stringify({ password }) })
  for (let i = 0; i < 10; i++) assert.equal((await guess(`wrong-${i}`)).status, 403)
  // Even the correct password is refused once the limit is reached.
  assert.equal((await guess('right')).status, 429)
  const other = await board({ accessPasswordHash: await hashBoardPassword('right') })
  assert.equal((await request(`/board/${other.roomId}/verify-access`, { method: 'POST', body: JSON.stringify({ password: 'right' }) })).status, 200)
})

test('locked board stub does not leak owner or edit history', async () => {
  const b = await board({ accessPasswordHash: await hashBoardPassword('x'), ownerUid: 'owner-1', lastEditedBy: { uid: 'owner-1', displayName: 'Owner' } })
  const { data } = await request(`/board/${b.roomId}`)
  assert.equal(data.locked, true)
  assert.equal(data.board.ownerUid, undefined)
  assert.equal(data.board.lastEditedBy, undefined)
  assert.equal(data.board.hasPassword, true)
})

test('renaming a board broadcasts BOARD_UPDATED to connected participants', async () => {
  const socket = await connect(), room = await board()
  await join(socket, room.roomId)
  const updated = event(socket, 'BOARD_UPDATED')
  const res = await request(`/board/${room.roomId}`, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) })
  assert.equal(res.status, 200)
  assert.equal((await updated).title, 'Renamed')
})

test('element ids are unique per board at the database level', async () => {
  await Element.init()
  const room = await board(), el = shape()
  await Element.create({ ...el, boardId: room.roomId })
  await assert.rejects(Element.create({ ...el, boardId: room.roomId }), /duplicate key/)
  // The same id on a different board is fine.
  await Element.create({ ...el, boardId: (await board()).roomId })
})

test('signaling relays require a target and reject oversized payloads', async () => {
  const a = await connect(), b = await connect(), room = await board()
  await join(a, room.roomId)
  const { credentials } = await join(b, room.roomId)
  let denied = event(a, 'OPERATION_ERROR')
  a.emit('WEBRTC_OFFER', { boardId: room.roomId, offer: { sdp: 'x' } })
  await denied
  denied = event(a, 'OPERATION_ERROR')
  a.emit('WEBRTC_OFFER', { boardId: room.roomId, targetSessionId: credentials.sessionId, offer: { sdp: 'x'.repeat(70000) } })
  await denied
  const relayed = event(b, 'WEBRTC_OFFER')
  a.emit('WEBRTC_OFFER', { boardId: room.roomId, targetSessionId: credentials.sessionId, offer: { type: 'offer', sdp: 'v=0' } })
  assert.equal((await relayed).offer.sdp, 'v=0')
})

test('cursor moves are relayed immediately and invalid ones are dropped', async () => {
  const a = await connect(), b = await connect(), room = await board()
  await join(a, room.roomId)
  await join(b, room.roomId)
  const cursors = event(b, 'CURSORS_UPDATE')
  a.emit('CURSOR_MOVE', { boardId: room.roomId, x: 'bad', y: 1 })
  a.emit('CURSOR_MOVE', { boardId: room.roomId, x: 5, y: 6 })
  const list = await cursors
  assert.deepEqual(list.map(c => [c.x, c.y]), [[5, 6]])
})

test('chat messages get server ids and sanitized mentions', async () => {
  const socket = await connect(), room = await board()
  await join(socket, room.roomId)
  const message = event(socket, 'CHAT_MESSAGE')
  socket.emit('CHAT_MESSAGE', { boardId: room.roomId, message: 'hi', mentions: [{ sessionId: 's1', username: 'Bob', evil: { $gt: 1 } }, null] })
  const msg = await message
  assert.match(msg.id, /^[0-9a-f-]{36}$/)
  assert.deepEqual(msg.mentions, [{ sessionId: 's1', username: 'Bob' }])
})

test('chat is persisted and replayed to people who join later', async () => {
  const a = await connect(), room = await board()
  await join(a, room.roomId)
  const echoed = event(a, 'CHAT_MESSAGE')
  a.emit('CHAT_MESSAGE', { boardId: room.roomId, message: 'saved for later' })
  const msg = await echoed
  assert.equal(await ChatMessage.countDocuments({ boardId: room.roomId }), 1)
  const late = await connect()
  const { state } = await join(late, room.roomId)
  assert.deepEqual(state.chat.map(m => m.message), ['saved for later'])
  assert.equal(state.chat[0].id, msg.id)
  const history = await request(`/board/${room.roomId}/chat`)
  assert.equal(history.data.messages[0].message, 'saved for later')
})

test('chat reactions are toggled on the server and broadcast as the full list', async () => {
  const a = await connect(), b = await connect(), room = await board()
  const { credentials } = await join(a, room.roomId)
  await join(b, room.roomId)
  const posted = event(b, 'CHAT_MESSAGE')
  a.emit('CHAT_MESSAGE', { boardId: room.roomId, message: 'react to me' })
  const msg = await posted
  let reacted = event(b, 'CHAT_REACTION')
  a.emit('CHAT_REACTION', { boardId: room.roomId, messageId: msg.id, emoji: '👍' })
  assert.deepEqual((await reacted).reactions, [{ emoji: '👍', sessionIds: [credentials.sessionId] }])
  reacted = event(b, 'CHAT_REACTION')
  a.emit('CHAT_REACTION', { boardId: room.roomId, messageId: msg.id, emoji: '👍' })
  assert.deepEqual((await reacted).reactions, [])
  const stored = await ChatMessage.findOne({ boardId: room.roomId, id: msg.id }).lean()
  assert.equal(stored.reactions.length, 0)
})

test('only the owner can clear chat on an owned board', async () => {
  const a = await connect(), owned = await board({ ownerUid: 'owner-1' }), open = await board()
  await join(a, owned.roomId)
  const posted = event(a, 'CHAT_MESSAGE')
  a.emit('CHAT_MESSAGE', { boardId: owned.roomId, message: 'keep me' })
  await posted
  const denied = event(a, 'OPERATION_ERROR')
  a.emit('CHAT_CLEAR', { boardId: owned.roomId })
  assert.match((await denied).message, /owner/)
  assert.equal(await ChatMessage.countDocuments({ boardId: owned.roomId }), 1)
  await join(a, open.roomId)
  const cleared = event(a, 'CHAT_CLEARED')
  a.emit('CHAT_CLEAR', { boardId: open.roomId })
  await cleared
})

test('versions snapshot server state, restore for everyone, and keep a safety copy', async () => {
  const a = await connect(), room = await board()
  await join(a, room.roomId)
  const first = shape(), second = shape()
  await Element.create({ ...first, boardId: room.roomId })
  const saved = await request(`/board/${room.roomId}/versions`, { method: 'POST', body: JSON.stringify({ label: 'One box', author: 'Student' }) })
  assert.equal(saved.status, 201)
  assert.equal(saved.data.version.count, 1)
  assert.equal(saved.data.version.createdBy.username, 'Student')
  await Element.create({ ...second, boardId: room.roomId })

  const synced = event(a, 'SYNC_STATE')
  const restored = await request(`/board/${room.roomId}/versions/${saved.data.version.id}/restore`, { method: 'POST', body: '{}' })
  assert.equal(restored.status, 200)
  assert.deepEqual((await synced).elements.map(e => e.id), [first.id])
  assert.deepEqual((await Element.find({ boardId: room.roomId }).lean()).map(e => e.id), [first.id])

  const list = await request(`/board/${room.roomId}/versions`)
  assert.deepEqual(list.data.versions.map(v => v.label), ['Before restoring "One box"', 'One box'])
  assert.equal(list.data.versions[0].count, 2)
  assert.equal(list.data.versions[0].elements, undefined)
  const detail = await request(`/board/${room.roomId}/versions/${saved.data.version.id}`)
  assert.equal(detail.data.version.elements.length, 1)
})

test('version history respects board access and ownership', async () => {
  const locked = await board({ accessPasswordHash: await hashBoardPassword('pw') })
  assert.equal((await request(`/board/${locked.roomId}/versions`)).status, 403)
  assert.equal((await request(`/board/${locked.roomId}/versions`, { method: 'POST', body: '{}' })).status, 403)
  const owned = await board({ ownerUid: 'owner-1' })
  await Element.create({ ...shape(), boardId: owned.roomId })
  const saved = await request(`/board/${owned.roomId}/versions`, { method: 'POST', body: '{}' })
  assert.equal(saved.status, 201)
  assert.equal((await request(`/board/${owned.roomId}/versions/${saved.data.version.id}/restore`, { method: 'POST', body: '{}' })).status, 403)
  assert.equal((await request(`/board/${owned.roomId}/versions/${saved.data.version.id}`, { method: 'DELETE' })).status, 403)
  assert.equal((await request(`/board/${owned.roomId}/versions/not-an-id`)).status, 400)
})

test('auto-snapshots only active boards, and only when they changed', async () => {
  const active = await board(), idle = await board()
  await Session.create({ boardId: active.roomId, sessionId: randomUUID(), username: 'A', color: '#123456' })
  await Element.create({ ...shape(), boardId: active.roomId })
  await Element.create({ ...shape(), boardId: idle.roomId })
  await autoSnapshotActiveBoards()
  await autoSnapshotActiveBoards()
  assert.equal(await BoardVersion.countDocuments({ boardId: active.roomId, auto: true }), 1)
  assert.equal(await BoardVersion.countDocuments({ boardId: idle.roomId }), 0)
  await Element.create({ ...shape(), boardId: active.roomId })
  await autoSnapshotActiveBoards()
  assert.equal(await BoardVersion.countDocuments({ boardId: active.roomId, auto: true }), 2)
})

test('cleanup removes chat and versions together with an expired board', async () => {
  const room = await board()
  await ChatMessage.create({ id: randomUUID(), boardId: room.roomId, sessionId: 's', username: 'A', color: '#123456', message: 'bye' })
  await BoardVersion.create({ boardId: room.roomId, label: 'v', count: 0, fingerprint: 'x', elements: [] })
  await Board.updateOne({ roomId: room.roomId }, { updatedAt: new Date(Date.now() - 180000) }, { timestamps: false })
  await cleanupExpiredBoards()
  assert.equal(await ChatMessage.countDocuments({ boardId: room.roomId }), 0)
  assert.equal(await BoardVersion.countDocuments({ boardId: room.roomId }), 0)
})

test('attendance: joins, call time and leaves are recorded and downloaded as Excel', async () => {
  const room = await board({ title: 'DBMS Lecture 5' })
  const teacher = await connect()
  const student = await connect()
  await join(teacher, room.roomId, { username: 'Asha (teacher)' })
  const { credentials } = await join(student, room.roomId, { username: 'Ravi' })
  const inCall = event(student, 'CALL_PARTICIPANTS')
  student.emit('CALL_JOIN', { boardId: room.roomId, audioEnabled: true, videoEnabled: false })
  await inCall
  await new Promise(resolve => setTimeout(resolve, 1200))
  student.emit('LEAVE_BOARD', { boardId: room.roomId })
  await event(teacher, 'USER_LEFT')

  const ravi = await Attendance.findOne({ boardId: room.roomId, sessionId: credentials.sessionId }).lean()
  assert.equal(ravi.segmentStart, null)
  assert.equal(ravi.callSegmentStart, null)
  assert.ok(ravi.presentSeconds >= 1 && ravi.callSeconds >= 1)
  assert.equal(ravi.joinCount, 1)

  const res = await fetch(`${base}/api/board/${room.roomId}/attendance?tz=Asia/Kolkata`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /spreadsheetml\.sheet/)
  assert.match(res.headers.get('content-disposition'), /Attendance-DBMS-Lecture-5-\d{4}-\d{2}-\d{2}\.xlsx/)
  const file = Buffer.from(await res.arrayBuffer())
  assert.equal(file.subarray(0, 2).toString(), 'PK')
  const text = file.toString('utf8')
  for (const value of ['Attendance register', 'DBMS Lecture 5', 'Asha (teacher)', 'Ravi', 'Present now', 'Left', 'Asia/Kolkata']) assert.ok(text.includes(value), value)

  // Reconnecting with the same session continues the same record.
  const again = await connect()
  await join(again, room.roomId, { ...credentials })
  const back = await Attendance.findOne({ boardId: room.roomId, sessionId: credentials.sessionId }).lean()
  assert.equal(back.joinCount, 2)
  assert.ok(back.segmentStart)
  assert.equal(await Attendance.countDocuments({ boardId: room.roomId }), 2)
})

test('attendance: only the board owner may download it, and private boards stay private', async () => {
  const owned = await board({ ownerUid: 'teacher-uid' })
  assert.equal((await request(`/board/${owned.roomId}/attendance`)).status, 401)
  const locked = await board({ accessPasswordHash: await hashBoardPassword('secret') })
  assert.equal((await request(`/board/${locked.roomId}/attendance`)).status, 403)
  assert.equal((await request('/board/no-such-board/attendance')).status, 404)
})

test('attendance: a call-leave racing a disconnect never counts the call twice', async () => {
  const now = Date.now()
  await Attendance.create({ boardId: 'race', sessionId: 's1', username: 'A', firstJoinedAt: new Date(now - 10000), lastSeenAt: new Date(now),
    segmentStart: new Date(now - 10000), callSegmentStart: new Date(now - 5000) })
  await Promise.all([markCallLeave('race', 's1'), markLeave('race', 's1'), markCallLeave('race', 's1')])
  const rec = await Attendance.findOne({ boardId: 'race', sessionId: 's1' }).lean()
  assert.ok(rec.callSeconds >= 4 && rec.callSeconds <= 7, `callSeconds ${rec.callSeconds}`)
  assert.ok(rec.presentSeconds >= 9 && rec.presentSeconds <= 12, `presentSeconds ${rec.presentSeconds}`)
  assert.equal(rec.segmentStart, null)
})

test('share roles: the role rules', () => {
  const owned = { ownerUid: 'host', linkAccess: 'view' }
  assert.equal(participantRole(owned, { userId: 'host' }), 'editor')
  assert.equal(participantRole(owned, {}), 'viewer')
  assert.equal(participantRole(owned, { viaEditLink: true }), 'editor')
  assert.equal(participantRole(owned, { viaEditLink: true, hostRole: 'viewer' }), 'viewer')
  assert.equal(participantRole({ ownerUid: 'host', linkAccess: 'edit' }, {}), 'editor')
  assert.equal(participantRole({ ownerUid: 'host', linkAccess: 'edit' }, { hostRole: 'viewer' }), 'viewer')
  assert.equal(participantRole({ ownerUid: null, linkAccess: 'view' }, {}), 'editor')
})

test('share roles: view-only link blocks edits on the server but allows chat; the editor link grants editing', async () => {
  const room = await board({ ownerUid: 'host', linkAccess: 'view', editLinkToken: 'editor-link-token-123' })
  const viewer = await connect()
  const { state } = await join(viewer, room.roomId, { username: 'Student' })
  assert.equal(state.role, 'viewer')
  assert.equal(state.linkAccess, 'view')
  for (const [name, payload] of [['ADD_ELEMENT', { element: shape() }], ['CLEAR_BOARD', {}], ['SYNC_STATE', { patches: [] }]]) {
    const rejected = event(viewer, 'OPERATION_ERROR')
    viewer.emit(name, { boardId: room.roomId, ...payload })
    assert.match((await rejected).message, /view-only/)
  }
  assert.equal(await Element.countDocuments({ boardId: room.roomId }), 0)
  const chat = event(viewer, 'CHAT_MESSAGE')
  viewer.emit('CHAT_MESSAGE', { boardId: room.roomId, message: 'Can I ask a question?' })
  assert.equal((await chat).message, 'Can I ask a question?')

  const editor = await connect()
  const { state: editorState } = await join(editor, room.roomId, { username: 'TA', editLink: 'editor-link-token-123' })
  assert.equal(editorState.role, 'editor')
  const added = event(viewer, 'ADD_ELEMENT')
  editor.emit('ADD_ELEMENT', { boardId: room.roomId, element: shape() })
  await added
  assert.equal(await Element.countDocuments({ boardId: room.roomId }), 1)

  const wrong = await connect()
  assert.equal((await join(wrong, room.roomId, { editLink: 'not-the-token' })).state.role, 'viewer')
  const presence = (await Session.find({ boardId: room.roomId }).lean()).map(s => s.role).sort()
  assert.deepEqual(presence, ['editor', 'viewer', 'viewer'])
})

test('share roles: changing the link setting updates everyone live, and the host choice survives a rejoin', async () => {
  const room = await board({ ownerUid: 'host', linkAccess: 'edit' })
  const student = await connect()
  const { credentials, state } = await join(student, room.roomId)
  assert.equal(state.role, 'editor')
  await Board.updateOne({ roomId: room.roomId }, { linkAccess: 'view' })
  const updated = event(student, 'ROLE_UPDATED')
  await refreshRoles(io, room.roomId)
  assert.equal((await updated).role, 'viewer')
  const rejected = event(student, 'OPERATION_ERROR')
  student.emit('ADD_ELEMENT', { boardId: room.roomId, element: shape() })
  assert.match((await rejected).message, /view-only/)

  // A host's explicit choice for one person wins over the general link setting, even after reconnecting.
  await Session.updateOne({ boardId: room.roomId, sessionId: credentials.sessionId }, { hostRole: 'editor' })
  const again = await connect()
  assert.equal((await join(again, room.roomId, credentials)).state.role, 'editor')
})

test('share roles: only the owner may change roles or read the editor link; viewers cannot rename or snapshot', async () => {
  const room = await board({ ownerUid: 'host', linkAccess: 'view' })
  const student = await connect()
  const { credentials } = await join(student, room.roomId)
  const denied = event(student, 'OPERATION_ERROR')
  student.emit('SET_ROLE', { boardId: room.roomId, targetSessionId: credentials.sessionId, role: 'editor' })
  assert.match((await denied).message, /owner/)
  assert.equal((await Session.findOne({ sessionId: credentials.sessionId }).lean()).role, 'viewer')

  assert.equal((await request(`/board/${room.roomId}/share`)).status, 401)
  assert.equal((await request(`/board/${room.roomId}/share/reset`, { method: 'POST' })).status, 401)
  assert.equal((await request(`/board/${room.roomId}`, { method: 'PATCH', body: JSON.stringify({ linkAccess: 'edit' }) })).status, 401)
  const headers = { 'x-session-id': credentials.sessionId, 'x-session-token': credentials.sessionToken }
  assert.equal((await request(`/board/${room.roomId}`, { method: 'PATCH', headers, body: JSON.stringify({ title: 'Hacked' }) })).status, 403)
  assert.equal((await request(`/board/${room.roomId}/versions`, { method: 'POST', headers, body: '{}' })).status, 403)
  assert.equal((await Board.findOne({ roomId: room.roomId }).lean()).title, 'Test')
  const meta = await request(`/board/${room.roomId}`)
  assert.equal(meta.data.board.editLinkToken, undefined)
})

test('API docs: OpenAPI spec lists the routes and Swagger UI is served', async () => {
  const spec = await request('/openapi.json')
  assert.equal(spec.data.openapi, '3.0.3')
  assert.ok(spec.data.paths['/board/{id}/versions/{versionId}/restore'])
  assert.ok(spec.data.paths['/board/{id}/attendance'])
  const page = await fetch(`${base}/api/docs`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /swagger-ui/)
})

test('frontend and backend use the same undo/patch logic', () => {
  const read = file => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(read('../src/lib/canvasHistory.js'), read('../../frontend/src/lib/canvasHistory.js'))
})
