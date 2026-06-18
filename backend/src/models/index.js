import mongoose from 'mongoose'

const boardSchema = new mongoose.Schema({
  title: { type: String, default: 'Untitled Board' },
  roomId: { type: String, required: true, unique: true, index: true },
  persistent: { type: Boolean, default: false },
  ownerUid: { type: String, default: null, index: true },
  requireAuth: { type: Boolean, default: false },
  isLocked: { type: Boolean, default: false },
  accessPasswordHash: { type: String, default: null },
  lastEditedBy: {
    uid: { type: String, default: null },
    displayName: { type: String, default: null },
  },
}, { timestamps: true })

export const Board = mongoose.model('Board', boardSchema)

const elementSchema = new mongoose.Schema({
  id: { type: String, required: true, index: true },
  boardId: { type: String, required: true, index: true },
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

export const Element = mongoose.model('Element', elementSchema)

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  boardId: { type: String, required: true, index: true },
  userId: { type: String, default: null, index: true },
  username: { type: String, required: true },
  color: { type: String, required: true },
  lastHeartbeat: { type: Date, default: Date.now },
}, { timestamps: true })

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
