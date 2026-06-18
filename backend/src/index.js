import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import mongoose from 'mongoose'
import boardRoutes from './routes/board.js'
import authRoutes from './routes/auth.js'
import { setupSocket } from './socket/handler.js'
import { startCleanupWorker } from './jobs/cleanup.js'
import { corsOriginCheck, getAllowedOrigins } from './lib/cors.js'

const app = express()
const httpServer = createServer(app)

// Render / Railway sit behind a reverse proxy
app.set('trust proxy', 1)

const io = new Server(httpServer, {
  cors: {
    origin: getAllowedOrigins(),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 20000,
})

// Middleware
app.use(cors({ origin: corsOriginCheck, credentials: true }))
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/board', boardRoutes)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Socket.io
setupSocket(io)

// Connect to MongoDB and start server
const PORT = process.env.PORT || 3001
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/aerix'

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
})
  .then(() => {
    console.log('[Aerix] Connected to MongoDB')
    httpServer.listen(PORT, () => {
      console.log(`[Aerix] Server running on port ${PORT}`)
    })
    startCleanupWorker()
  })
  .catch((err) => {
    console.error('[Aerix] MongoDB connection error:', err)
    process.exit(1)
  })
