import mongoose from 'mongoose'

const boardSchema = new mongoose.Schema({
  title: { type: String, default: 'Untitled Board' },
  roomId: { type: String, required: true, unique: true, index: true },
  persistent: { type: Boolean, default: false },
  ownerUid: { type: String, default: null, index: true },
  requireAuth: { type: Boolean, default: false },
  isLocked: { type: Boolean, default: false },
  emptySince: { type: Date, default: Date.now, index: true },
  accessPasswordHash: { type: String, default: null },
  // Share settings: what the plain board link allows, and a secret link that always grants editing.
  linkAccess: { type: String, enum: ['edit', 'view'], default: 'edit' },
  editLinkToken: { type: String, default: null, select: false },
  lastEditedBy: {
    uid: { type: String, default: null },
    displayName: { type: String, default: null },
  },
}, { timestamps: true })

// Cleanup job scans temporary boards by last activity.
boardSchema.index({ persistent: 1, updatedAt: 1 })

export const Board = mongoose.model('Board', boardSchema)

const elementSchema = new mongoose.Schema({
  id: { type: String, required: true },
  boardId: { type: String, required: true },
  type: { type: String, required: true, enum: ['rectangle', 'circle', 'line', 'arrow', 'text', 'sticky', 'pen', 'image', 'frame'] },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  width: Number,
  height: Number,
  rotation: Number,
  fill: String,
  stroke: String,
  strokeWidth: Number,
  text: String,
  fontSize: Number,
  fontFamily: String,
  fontStyle: String,
  textDecoration: String,
  points: [Number],
  opacity: Number,
  cornerRadius: Number,
  draggable: { type: Boolean, default: true },
  createdBy: String,
  imageSrc: String,
}, { timestamps: true })

// An element id is unique within its board; also serves every per-board query.
elementSchema.index({ boardId: 1, id: 1 }, { unique: true })

export const Element = mongoose.model('Element', elementSchema)

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  boardId: { type: String, required: true },
  userId: { type: String, default: null, index: true },
  resumeTokenHash: { type: String, select: false },
  username: { type: String, required: true },
  color: { type: String, required: true },
  lastHeartbeat: { type: Date, default: Date.now },
  // Effective permission, the host's explicit choice for this person (if any), and whether they used the editor link.
  role: { type: String, enum: ['editor', 'viewer'], default: 'editor' },
  hostRole: { type: String, enum: ['editor', 'viewer', null], default: null },
  viaEditLink: { type: Boolean, default: false },
}, { timestamps: true })

sessionSchema.index({ boardId: 1, sessionId: 1 }, { unique: true })
sessionSchema.index({ lastHeartbeat: 1 })

export const Session = mongoose.model('Session', sessionSchema)

const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true, index: true },
  email: { type: String, default: null },
  displayName: { type: String, required: true },
  photoURL: { type: String, default: null },
}, { timestamps: true })

export const User = mongoose.model('User', userSchema)

const userBoardSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, index: true },
  boardId: { type: String, required: true, index: true },
  title: { type: String, default: 'Untitled Board' },
  lastVisited: { type: Date, default: Date.now },
}, { timestamps: true })

userBoardSchema.index({ firebaseUid: 1, boardId: 1 }, { unique: true })

export const UserBoard = mongoose.model('UserBoard', userBoardSchema)

/* ── Chat: persisted so history survives reloads and reaches late joiners ── */
const chatMessageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  boardId: { type: String, required: true },
  sessionId: { type: String, required: true },
  userId: { type: String, default: null },
  username: { type: String, required: true },
  color: { type: String, required: true },
  message: { type: String, required: true, maxlength: 4000 },
  mentions: [{ _id: false, sessionId: String, username: String }],
  reactions: [{ _id: false, emoji: String, sessionIds: [String] }],
}, { timestamps: { createdAt: true, updatedAt: false } })

chatMessageSchema.index({ boardId: 1, id: 1 }, { unique: true })
chatMessageSchema.index({ boardId: 1, createdAt: -1 })

export const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema)

/* ── Version history: point-in-time snapshots of a board's elements ── */
const boardVersionSchema = new mongoose.Schema({
  boardId: { type: String, required: true },
  label: { type: String, required: true, maxlength: 80 },
  auto: { type: Boolean, default: false },
  createdBy: {
    uid: { type: String, default: null },
    username: { type: String, default: null },
  },
  count: { type: Number, required: true },
  // sha256 of the snapshot, so auto-saves skip boards that have not changed
  fingerprint: { type: String, required: true },
  elements: { type: Array, default: [] },
}, { timestamps: { createdAt: true, updatedAt: false } })

boardVersionSchema.index({ boardId: 1, createdAt: -1 })

export const BoardVersion = mongoose.model('BoardVersion', boardVersionSchema)

/* ── Attendance: one record per participant session on a board (who joined, when, for how long) ── */
const attendanceSchema = new mongoose.Schema({
  boardId: { type: String, required: true },
  sessionId: { type: String, required: true },
  userId: { type: String, default: null },
  username: { type: String, required: true },
  firstJoinedAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  // Open presence / call interval; null while the person is away.
  segmentStart: { type: Date, default: null },
  presentSeconds: { type: Number, default: 0 },
  callSegmentStart: { type: Date, default: null },
  callSeconds: { type: Number, default: 0 },
  joinCount: { type: Number, default: 0 },
})

attendanceSchema.index({ boardId: 1, sessionId: 1 }, { unique: true })

export const Attendance = mongoose.model('Attendance', attendanceSchema)
