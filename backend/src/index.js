import 'dotenv/config'
import mongoose from 'mongoose'
import { createApp } from './app.js'
import { startCleanupWorker } from './jobs/cleanup.js'
import { isFirebaseConfigured } from './lib/firebase.js'

const firebaseKeys = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
if (firebaseKeys.some(key => process.env[key]) && !isFirebaseConfigured()) {
  throw new Error('Incomplete Firebase Admin configuration; fill all three variables or leave all blank for guest mode')
}
if (process.env.NODE_ENV === 'production' && !process.env.MONGO_URI && !process.env.MONGODB_URI) {
  throw new Error('MONGO_URI must be configured in production')
}
const { httpServer, io } = createApp()
const port = Number(process.env.PORT || 3001)
try {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/zephros', { serverSelectionTimeoutMS: 10000 })
  httpServer.listen(port, () => console.log(`[Zephros] Backend http://localhost:${port} (${isFirebaseConfigured() ? 'Firebase enabled' : 'guest mode'})`))
  const workers = startCleanupWorker()
  const shutdown = async (signal) => {
    console.log(`[Zephros] ${signal} received, shutting down`)
    workers.stop()
    // Never hang a deploy: force-exit if sockets or Mongo do not close within 10s.
    setTimeout(() => process.exit(1), 10000).unref()
    await new Promise(resolve => io.close(resolve)) // also closes the HTTP server
    await mongoose.disconnect()
    process.exit(0)
  }
  process.on('unhandledRejection', reason => console.error('[Zephros] Unhandled rejection:', reason))
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
} catch (error) {
  console.error('[Zephros] Startup failed:', error.message)
  console.error('For a local database without Atlas, run npm run dev:local from the repository root.')
  process.exit(1)
}
