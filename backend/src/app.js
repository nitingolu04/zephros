import express from 'express'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Server } from 'socket.io'
import cors from 'cors'
import mongoose from 'mongoose'
import boardRoutes from './routes/board.js'
import authRoutes from './routes/auth.js'
import { setupSocket } from './socket/handler.js'
import { corsOriginCheck, getAllowedOrigins } from './lib/cors.js'
import { errorResponse } from './lib/validation.js'
import { createLimiter } from './lib/rateLimit.js'
import { openApiSpec, swaggerHtml } from './lib/openapi.js'

const startedAt = Date.now()

export function createApp() {
  const app = express()
  const httpServer = createServer(app)
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  const io = new Server(httpServer, {
    cors: { origin: getAllowedOrigins(), methods: ['GET', 'POST'], credentials: true },
    maxHttpBufferSize: 8 * 1024 * 1024,
    pingInterval: 25000,
    pingTimeout: 20000,
  })
  app.set('io', io)

  // Baseline security headers for a JSON-only API (what helmet would set for this case).
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id']?.toString().slice(0, 64) || randomUUID()
    res.setHeader('X-Request-Id', req.id)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    next()
  })
  app.use(cors({ origin: corsOriginCheck, credentials: true }))
  app.use(express.json({ limit: '8mb' }))

  // 300 API requests per minute per IP. Per process; use a shared store when scaling out.
  const apiLimiter = createLimiter({ limit: 300, windowMs: 60000 })
  httpServer.on('close', () => apiLimiter.stop())
  app.use('/api', (req, res, next) => {
    if (apiLimiter.hit(req.ip)) return res.status(429).json({ error: 'Too many requests; retry in a minute' })
    next()
  })

  app.use('/api/auth', authRoutes)
  app.use('/api/board', boardRoutes)
  app.get('/api/health', (_req, res) => {
    const ready = mongoose.connection.readyState === 1
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'unavailable',
      database: ready ? 'connected' : 'disconnected',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      connections: io.engine.clientsCount,
    })
  })
  app.get('/api/openapi.json', (_req, res) => res.json(openApiSpec))
  app.get('/api/docs', (_req, res) => {
    // The docs page needs the Swagger UI assets; everything else keeps the strict API policy.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:; connect-src 'self'")
    res.type('html').send(swaggerHtml)
  })
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }))
  app.use(errorResponse)
  setupSocket(io)
  return { app, httpServer, io }
}
