import type { ApiResponse, CreateBoardResponse, Board, CanvasElement, BoardHistoryItem } from '@/types'

function apiBaseUrl(): string {
  const env = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
  if (env) return `${env}/api`
  if (typeof window !== 'undefined') return `${window.location.origin}/api`
  return '/api'
}

const REQUEST_TIMEOUT_MS = 15000

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
    const res = await fetch(`${apiBaseUrl()}${url}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...authHeaders,
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

  exportPng: async (id: string): Promise<Blob | null> => {
    try {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`${apiBaseUrl()}/board/${id}/export/png`, { headers: authHeaders })
      if (!res.ok) return null
      return await res.blob()
    } catch {
      return null
    }
  },
}
