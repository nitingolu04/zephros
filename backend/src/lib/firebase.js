import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

let initialized = false

export function isFirebaseConfigured() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY,
  )
}

function ensureFirebaseApp() {
  if (!isFirebaseConfigured()) return null

  if (!initialized) {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      })
    }
    initialized = true
  }

  return getAuth()
}

export async function verifyIdToken(token) {
  const auth = ensureFirebaseApp()
  if (!auth || !token) return null

  try {
    return await auth.verifyIdToken(token)
  } catch {
    return null
  }
}
