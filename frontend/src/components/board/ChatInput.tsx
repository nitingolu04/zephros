import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { UserSession, ChatMention } from '@/types'
import { socketService } from '@/services/socket'

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: (message: string, mentions: ChatMention[]) => void
  activeUsers: UserSession[]
  currentSessionId: string
  boardId?: string
}

export default function ChatInput({ value, onChange, onSubmit, activeUsers, currentSessionId, boardId }: Props) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const typingRef = useRef(false)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const emitTyping = (typing: boolean) => {
    if (!boardId || typingRef.current === typing) return
    typingRef.current = typing
    socketService.emitChatTyping(boardId, typing)
  }

  const others = activeUsers.filter((u) => u.sessionId !== currentSessionId)

  const filtered = mentionQuery !== null
    ? others.filter((u) => u.username.toLowerCase().includes(mentionQuery.toLowerCase()))
    : []

  const insertMention = (user: UserSession) => {
    const atIndex = value.lastIndexOf('@')
    const before = value.slice(0, atIndex)
    onChange(`${before}@${user.username} `)
    setMentionQuery(null)
    inputRef.current?.focus()
  }

  const parseMentions = (text: string): ChatMention[] => {
    const mentions: ChatMention[] = []
    for (const u of others) {
      if (text.includes(`@${u.username}`)) {
        mentions.push({ sessionId: u.sessionId, username: u.username })
      }
    }
    return mentions
  }

  const handleChange = (text: string) => {
    onChange(text)
    const match = text.match(/@(\w*)$/)
    setMentionQuery(match ? match[1] : null)
    if (boardId) {
      if (text.trim()) {
        emitTyping(true)
        clearTimeout(typingTimerRef.current)
        typingTimerRef.current = setTimeout(() => emitTyping(false), 2000)
      } else {
        emitTyping(false)
      }
    }
  }

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const msg = value.trim()
    if (!msg) return
    emitTyping(false)
    onSubmit(msg, parseMentions(msg))
    onChange('')
    setMentionQuery(null)
  }

  useEffect(() => {
    return () => {
      clearTimeout(typingTimerRef.current)
      if (boardId && typingRef.current) emitTyping(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMentionQuery(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <form onSubmit={handleSubmit} className="relative flex gap-2">
      {mentionQuery !== null && filtered.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 max-h-32 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {filtered.map((u) => (
            <button
              key={u.sessionId}
              type="button"
              onClick={() => insertMention(u)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: u.color }}
              >
                {u.username.slice(0, 2).toUpperCase()}
              </span>
              @{u.username}
            </button>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        placeholder="Type a message... @ to mention"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm outline-none focus:border-accent"
      />
    </form>
  )
}

export function renderMessageWithMentions(
  message: string,
  mentions: ChatMention[] | undefined,
  currentSessionId: string,
): ReactNode {
  if (!mentions?.length) return message

  const parts: ReactNode[] = []
  let remaining = message
  const sorted = [...mentions].sort((a, b) => b.username.length - a.username.length)

  for (const m of sorted) {
    const token = `@${m.username}`
    const idx = remaining.indexOf(token)
    if (idx === -1) continue
    if (idx > 0) parts.push(remaining.slice(0, idx))
    const isMe = m.sessionId === currentSessionId
    parts.push(
      <span
        key={`${m.sessionId}-${idx}`}
        className={isMe ? 'font-semibold text-yellow-300' : 'font-semibold text-accent'}
      >
        {token}
      </span>,
    )
    remaining = remaining.slice(idx + token.length)
  }
  if (remaining) parts.push(remaining)
  return parts.length ? parts : message
}
