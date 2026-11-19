import { boardAccessHeaders } from '@/lib/session'
import type { ApiResponse, CreateBoardResponse, Board, CanvasElement, BoardHistoryItem } from '@/types'

function apiBaseUrl(): string {
  const env = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
  if (env) return `${env}/api`
  if (typeof window !== 'undefined') return `${window.location.origin}/api`
  return '/api'
}

// Free hosting can take up to a minute to wake from sleep.
const REQUEST_TIMEOUT_MS = 60000

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { useAuthStore } = await import('@/stores/authStore')
    const token = await useAuthStore.getState().getIdToken()
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {
    // proceed without token
  }
  return headers
}

async function request<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const authHeaders = await getAuthHeaders()
    const boardId = url.match(/^\/board\/([^/]+)/)?.[1]
    const accessHeaders = boardId ? boardAccessHeaders(boardId) : {}
    const res = await fetch(`${apiBaseUrl()}${url}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...authHeaders,
        ...accessHeaders,
        ...(options?.headers as Record<string, string> | undefined),
      },
    })

    const text = await res.text()
    let data: T & { error?: string }
    try {
      data = JSON.parse(text) as T & { error?: string }
    } catch {
      throw new Error(
        text.trimStart().startsWith('<')
          ? 'Server returned HTML instead of JSON — check VITE_API_URL'
          : 'Invalid server response',
      )
    }

    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
    return { success: true, data }
  } catch (err) {
    const message = (err as Error).name === 'AbortError'
      ? 'Request timed out — server may be waking up, try again'
      : (err as Error).message
    return { success: false, error: message }
  } finally {
    clearTimeout(timer)
  }
}

/** Start waking a sleeping backend as soon as the site opens, before the first real action. */
export function wakeBackend() {
  if (import.meta.env.VITE_API_URL) void fetch(`${apiBaseUrl()}/health`).catch(() => {})
}

export const api = {
  syncAuthUser: () =>
    request<{ uid: string; email: string | null; displayName: string; photoURL: string | null }>('/auth/sync', {
      method: 'POST',
    }),

  getProfile: () =>
    request<{ uid: string; email: string | null; displayName: string; photoURL: string | null }>('/auth/me'),

  updateProfile: (data: { displayName: string }) =>
    request<{ uid: string; email: string | null; displayName: string; photoURL: string | null }>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getBoardHistory: () =>
    request<{ boards: BoardHistoryItem[] }>('/auth/boards'),

  recordBoardVisit: (boardId: string, title?: string) =>
    request<void>('/auth/boards/visit', {
      method: 'POST',
      body: JSON.stringify({ boardId, title }),
    }),

  createBoard: (title?: string, persistent?: boolean) =>
    request<CreateBoardResponse>('/board/create', {
      method: 'POST',
      body: JSON.stringify({ title: title || 'Untitled Board', persistent }),
    }),

  updateBoard: (id: string, data: {
    title?: string
    persistent?: boolean
    requireAuth?: boolean
    isLocked?: boolean
    password?: string
    clearPassword?: boolean
    linkAccess?: 'edit' | 'view'
  }) =>
    request<{ board: Board }>(`/board/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getBoard: (id: string, opts?: { boardPassword?: string; sessionId?: string }) =>
    request<{ board: Board; elements: CanvasElement[]; locked?: boolean; reason?: 'auth' | 'password' | 'locked' }>(
      `/board/${id}`,
      {
        headers: {
          ...(opts?.boardPassword ? { 'X-Board-Password': opts.boardPassword } : {}),
          ...(opts?.sessionId ? { 'X-Session-Id': opts.sessionId } : {}),
        },
      },
    ),

  verifyBoardAccess: (id: string, password: string) =>
    request<{ valid: boolean }>(`/board/${id}/verify-access`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  deleteBoard: (id: string) =>
    request<void>(`/board/${id}`, { method: 'DELETE' }),

  duplicateBoard: (id: string) =>
    request<CreateBoardResponse>(`/board/${id}/duplicate`, { method: 'POST' }),

  exportJson: (id: string) =>
    request<{ board: Board; elements: CanvasElement[] }>(`/board/${id}/export/json`),

  /** Share settings (owner only): what the board link allows and the secret editor link. */
  getShare: (id: string) =>
    request<{ linkAccess: 'edit' | 'view'; editLinkToken: string }>(`/board/${id}/share`),

  resetEditLink: (id: string) =>
    request<{ linkAccess: 'edit' | 'view'; editLinkToken: string }>(`/board/${id}/share/reset`, { method: 'POST' }),

  /** Excel attendance register (board owner only). Times are written in the viewer's time zone. */
  downloadAttendance: async (id: string): Promise<{ blob?: Blob; fileName?: string; error?: string }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const res = await fetch(`${apiBaseUrl()}/board/${id}/attendance?tz=${encodeURIComponent(tz)}`, {
        signal: controller.signal,
        headers: { ...(await getAuthHeaders()), ...boardAccessHeaders(id) },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null
        return { error: data?.error || `Download failed (${res.status})` }
      }
      const date = new Date().toLocaleDateString('en-CA')
      return { blob: await res.blob(), fileName: `Attendance-${date}.xlsx` }
    } catch (err) {
      return { error: (err as Error).name === 'AbortError' ? 'Request timed out — try again' : (err as Error).message }
    } finally {
      clearTimeout(timer)
    }
  },

  /* ── Version history (server) ── */
  listVersions: (id: string) =>
    request<{ versions: ServerVersion[]; canManage: boolean }>(`/board/${id}/versions`),

  createVersion: (id: string, label: string, author?: string) =>
    request<{ version: ServerVersion }>(`/board/${id}/versions`, {
      method: 'POST',
      body: JSON.stringify({ label, author }),
    }),

  restoreVersion: (id: string, versionId: string, author?: string) =>
    request<{ success: boolean; count: number; label: string }>(`/board/${id}/versions/${versionId}/restore`, {
      method: 'POST',
      body: JSON.stringify({ author }),
    }),

  deleteVersion: (id: string, versionId: string) =>
    request<{ success: boolean }>(`/board/${id}/versions/${versionId}`, { method: 'DELETE' }),
}

export interface ServerVersion {
  id: string
  label: string
  auto: boolean
  count: number
  createdBy: { uid: string | null; username: string } | null
  createdAt: string
}

/** True when an error means "this backend doesn't have the endpoint" (older backend). */
export function isMissingEndpoint(error?: string) {
  return Boolean(error && (/endpoint not found|request failed \(404\)/i.test(error) || /HTML instead of JSON/i.test(error)))
}
