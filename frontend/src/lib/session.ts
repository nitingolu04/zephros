function storedId(key: string): string {
  try {
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const value = crypto.randomUUID()
    sessionStorage.setItem(key, value)
    return value
  } catch {
    return crypto.randomUUID()
  }
}

export const sessionId = storedId('zephros_session_id')
// Unlike sessionId, this secret is never included in public participant lists.
export const sessionToken = storedId('zephros_session_token')

export function boardAccessHeaders(boardId: string): Record<string, string> {
  let password: string | null = null
  try { password = sessionStorage.getItem(`zephros_board_pwd_${boardId}`) } catch { /* unavailable storage */ }
  return { 'X-Session-Id': sessionId, 'X-Session-Token': sessionToken, ...(password ? { 'X-Board-Password': password } : {}) }
}
