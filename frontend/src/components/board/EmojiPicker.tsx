import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

const EMOJI_GROUPS = [
  { label: 'Smileys', emojis: ['😀', '😂', '😍', '🥳', '😎', '🤔', '😢', '😡', '🙏', '👋'] },
  { label: 'Gestures', emojis: ['👍', '👎', '👏', '🙌', '💪', '🤝', '✌️', '🤞', '👀', '💯'] },
  { label: 'Hearts', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💕', '✨', '⭐'] },
  { label: 'Objects', emojis: ['🎉', '🔥', '💡', '✅', '❌', '⚡', '🚀', '🎨', '📝', '💬'] },
]

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (emoji: string) => void
}

export default function EmojiPicker({ open, onClose, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  if (!open) return null

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      style={{
        position: 'absolute',
        bottom: '100%',
        right: 0,
        marginBottom: 8,
        width: 280,
        maxHeight: 240,
        overflowY: 'auto',
        borderRadius: 14,
        border: '1px solid var(--color-border)',
        background: 'var(--color-card)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
        padding: 12,
        zIndex: 50,
      }}
    >
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label} style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-muted-foreground)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {group.label}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
            {group.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onSelect(emoji)
                  onClose()
                }}
                style={{
                  height: 36,
                  borderRadius: 8,
                  border: 'none',
                  background: 'transparent',
                  fontSize: 20,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-muted)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </motion.div>
  )
}
