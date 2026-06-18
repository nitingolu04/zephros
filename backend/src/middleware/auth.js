import { verifyIdToken, isFirebaseConfigured } from '../lib/firebase.js'
import { User } from '../models/index.js'

export async function optionalAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    req.user = null
    return next()
  }

  const token = header.slice(7)
  const decoded = await verifyIdToken(token)

  if (!decoded) {
    if (isFirebaseConfigured()) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    req.user = null
    return next()
  }

  req.user = decoded
  next()
}

export async function requireAuth(req, res, next) {
  if (!isFirebaseConfigured()) {
    return next()
  }

  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const decoded = await verifyIdToken(header.slice(7))
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  req.user = decoded
  next()
}

export async function upsertUserFromToken(decoded) {
  const displayName = decoded.name || decoded.email?.split('@')[0] || 'User'

  return User.findOneAndUpdate(
    { firebaseUid: decoded.uid },
    {
      $set: {
        email: decoded.email || null,
        photoURL: decoded.picture || null,
      },
      $setOnInsert: {
        firebaseUid: decoded.uid,
        displayName,
      },
    },
    { upsert: true, new: true },
  )
}
