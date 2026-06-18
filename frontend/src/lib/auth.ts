import { useNavigate } from 'react-router-dom'
import { isFirebaseConfigured } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'

/** Redirect to login if Firebase auth is enabled and user is not signed in. Returns true if action can proceed. */
export function requireAuthForAction(
  navigate: ReturnType<typeof useNavigate>,
  redirectPath: string,
): boolean {
  const user = useAuthStore.getState().user
  if (!isFirebaseConfigured || user) return true

  const loginUrl = `/login?redirect=${encodeURIComponent(redirectPath)}`
  navigate(loginUrl)
  return false
}
