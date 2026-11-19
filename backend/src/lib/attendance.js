import { Attendance, User } from '../models/index.js'
import { buildXlsx, STYLE } from './xlsx.js'

const seconds = (from, to) => Math.max(0, Math.round((to - from) / 1000))

/** Someone (re)joined the board. Reconnects of the same session continue one record. */
export async function markJoin(boardId, { sessionId, userId, username }) {
  const now = new Date()
  const rec = await Attendance.findOne({ boardId, sessionId })
  if (!rec) {
    await Attendance.create({ boardId, sessionId, userId, username, firstJoinedAt: now, lastSeenAt: now, segmentStart: now, joinCount: 1 })
    return
  }
  rec.username = username
  if (userId) rec.userId = userId
  rec.lastSeenAt = now
  if (!rec.segmentStart) { rec.segmentStart = now; rec.joinCount += 1 }
  await rec.save()
}

// Seconds since an interval opened, added in a single atomic update so that a call-leave and a
// board-leave racing on disconnect can never count the same interval twice.
const closeInterval = (total, start) => ({
  $cond: [{ $eq: [`$${start}`, null] }, `$${total}`,
    { $add: [`$${total}`, { $max: [0, { $round: [{ $divide: [{ $subtract: ['$$NOW', `$${start}`] }, 1000] }, 0] }] }] }],
})

/** Someone left the board (or disconnected): close the open presence and call intervals. */
export async function markLeave(boardId, sessionId) {
  await Attendance.updateOne({ boardId, sessionId }, [{
    $set: {
      presentSeconds: closeInterval('presentSeconds', 'segmentStart'),
      callSeconds: closeInterval('callSeconds', 'callSegmentStart'),
      segmentStart: null,
      callSegmentStart: null,
      lastSeenAt: '$$NOW',
    },
  }])
}

export async function markCallJoin(boardId, sessionId) {
  const now = new Date()
  await Attendance.updateOne({ boardId, sessionId, callSegmentStart: null }, { callSegmentStart: now, lastSeenAt: now })
}

export async function markCallLeave(boardId, sessionId) {
  await Attendance.updateOne({ boardId, sessionId, callSegmentStart: { $ne: null } }, [{
    $set: { callSeconds: closeInterval('callSeconds', 'callSegmentStart'), callSegmentStart: null, lastSeenAt: '$$NOW' },
  }])
}

/** Heartbeat: remember when we last heard from this person (used if their connection drops). */
export async function touch(boardId, sessionId) {
  await Attendance.updateOne({ boardId, sessionId }, { lastSeenAt: new Date() })
}

/**
 * Attendance for a board, earliest arrival first. Open intervals count up to now for people who are
 * online, and up to their last heartbeat for people whose connection was lost without a clean leave.
 */
export async function attendanceReport(boardId, isOnline, now = new Date()) {
  const records = await Attendance.find({ boardId }).sort({ firstJoinedAt: 1 }).lean()
  const uids = [...new Set(records.map(r => r.userId).filter(Boolean))]
  const users = uids.length ? await User.find({ firebaseUid: { $in: uids } }, { firebaseUid: 1, email: 1 }).lean() : []
  const byUid = new Map(users.map(u => [u.firebaseUid, u]))
  return records.map(r => {
    const online = isOnline(r.sessionId)
    const end = online ? now : new Date(r.lastSeenAt)
    const present = r.presentSeconds + (r.segmentStart ? seconds(new Date(r.segmentStart), end) : 0)
    const inCall = r.callSeconds + (r.callSegmentStart ? seconds(new Date(r.callSegmentStart), end) : 0)
    return {
      name: r.username,
      email: (r.userId && byUid.get(r.userId)?.email) || '-',
      account: r.userId ? 'Google sign-in' : 'Guest',
      status: online ? 'Present now' : 'Left',
      firstJoinedAt: new Date(r.firstJoinedAt),
      lastSeenAt: end,
      presentSeconds: present,
      callSeconds: inCall,
      joinCount: r.joinCount,
    }
  })
}

/** Accept an IANA time zone from the browser (e.g. "Asia/Kolkata"); fall back to UTC. */
export function validTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

const minutes = s => Math.round((s / 60) * 10) / 10

/** The downloadable register: a short header block, then one row per participant. */
export function attendanceWorkbook(board, rows, timeZone, now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  })
  const time = d => fmt.format(d)
  const presentNow = rows.filter(r => r.status === 'Present now').length
  const header = ['S.No', 'Name', 'Email', 'Account', 'Status', 'First joined', 'Last seen', 'Time on board (min)', 'Time in call (min)', 'Times joined']
  const sheetRows = [
    [{ v: 'Attendance register', s: STYLE.title }],
    [{ v: 'Board', s: STYLE.bold }, board.title || 'Untitled Board'],
    [{ v: 'Downloaded', s: STYLE.bold }, `${time(now)} (${timeZone})`],
    [{ v: 'Participants', s: STYLE.bold }, rows.length, { v: 'Present now', s: STYLE.bold }, presentNow],
    [],
    header.map(v => ({ v, s: STYLE.header })),
    ...rows.map((r, i) => [i + 1, r.name, r.email, r.account, r.status, time(r.firstJoinedAt), time(r.lastSeenAt),
      minutes(r.presentSeconds), minutes(r.callSeconds), r.joinCount].map(v => ({ v, s: STYLE.cell }))),
  ]
  return buildXlsx([{ name: 'Attendance', columns: [7, 24, 30, 15, 13, 21, 21, 19, 17, 13], freezeRow: 6, rows: sheetRows }])
}

export function attendanceFileName(board, timeZone, now = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const title = String(board.title || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40)
  return `Attendance-${title || board.roomId}-${date}.xlsx`
}
