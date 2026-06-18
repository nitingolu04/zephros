import { create } from 'zustand'
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth'
import { auth, googleProvider, isFirebaseConfigured } from '@/lib/firebase'
import { api } from '@/services/api'
import { socketService } from '@/services/socket'

export interface AuthUser {
  uid: string
  email: string | null
  displayName: string
  photoURL: string | null
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  initialized: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  getIdToken: () => Promise<string | null>
  init: () => () => void
}

function mapUser(user: FirebaseUser): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email?.split('@')[0] || 'User',
    photoURL: user.photoURL,
  }
}

function applyUserToSocket(user: AuthUser | null) {
  if (user) {
    socketService.username = user.displayName
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: isFirebaseConfigured,
  initialized: !isFirebaseConfigured,

  signInWithGoogle: async () => {
    if (!auth) throw new Error('Firebase is not configured')
    const result = await signInWithPopup(auth, googleProvider)
    const mapped = mapUser(result.user)
    applyUserToSocket(mapped)
    set({ user: mapped, loading: false })
    const syncRes = await api.syncAuthUser()
    if (syncRes.success && syncRes.data) {
      const synced = {
        uid: syncRes.data.uid,
        email: syncRes.data.email,
        displayName: syncRes.data.displayName,
        photoURL: syncRes.data.photoURL,
      }
      applyUserToSocket(synced)
      set({ user: synced })
    }
  },

  signOut: async () => {
    if (auth) await firebaseSignOut(auth)
    set({ user: null })
  },

  getIdToken: async () => {
    if (!auth?.currentUser) return null
    return auth.currentUser.getIdToken()
  },

  init: () => {
    if (!isFirebaseConfigured || !auth) {
      set({ loading: false, initialized: true })
      return () => {}
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const mapped = mapUser(firebaseUser)
        applyUserToSocket(mapped)
        set({ user: mapped, loading: false, initialized: true })
        const syncRes = await api.syncAuthUser()
        if (syncRes.success && syncRes.data) {
          const synced = {
            uid: syncRes.data.uid,
            email: syncRes.data.email,
            displayName: syncRes.data.displayName,
            photoURL: syncRes.data.photoURL,
          }
          applyUserToSocket(synced)
          set({ user: synced })
        }
      } else {
        set({ user: null, loading: false, initialized: true })
      }
    })

    return unsubscribe
  },
}))

export function useAuthRequired() {
  return isFirebaseConfigured
}
