import { motion, AnimatePresence } from 'framer-motion'
import { useBoardStore } from '@/stores/boardStore'

const shortcuts = [
  ['P', 'Pen'],
  ['R', 'Rectangle'],
  ['S', 'Sticky note'],
  ['T', 'Text'],
] as const

/** Friendly welcome on a blank board. Purely decorative: never intercepts clicks. */
export default function EmptyCanvasHint() {
  const empty = useBoardStore(s => s.elements.length === 0)
  const viewer = useBoardStore(s => s.myRole === 'viewer')
  if (viewer) return null
  return (
    <AnimatePresence>
      {empty && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden
          style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 5 }}
        >
          <div style={{ textAlign: 'center', maxWidth: 460, padding: 24 }}>
            <div style={{ position: 'relative', width: 120, height: 84, margin: '0 auto 22px' }}>
              <motion.span initial={{ rotate: -14, y: 6 }} animate={{ rotate: -8, y: 0 }} transition={{ delay: 0.15, type: 'spring', stiffness: 160, damping: 14 }}
                style={{ position: 'absolute', left: 8, top: 10, width: 60, height: 60, borderRadius: 6, background: 'var(--color-note-yellow)', boxShadow: '0 8px 18px rgba(24,24,27,0.10)' }} />
              <motion.span initial={{ rotate: 14, y: 6 }} animate={{ rotate: 7, y: 0 }} transition={{ delay: 0.25, type: 'spring', stiffness: 160, damping: 14 }}
                style={{ position: 'absolute', right: 8, top: 4, width: 56, height: 56, borderRadius: 6, background: 'var(--color-note-mint)', boxShadow: '0 8px 18px rgba(24,24,27,0.10)' }} />
              <svg viewBox="0 0 120 84" style={{ position: 'absolute', inset: 0 }}>
                <motion.path d="M20 74 C 40 58, 70 82, 100 60" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.45, duration: 0.8, ease: 'easeInOut' }} />
              </svg>
            </div>
            <p style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--color-foreground)' }}>
              A blank canvas, <span className="font-display" style={{ fontStyle: 'italic', fontWeight: 400 }}>all yours.</span>
            </p>
            <p style={{ fontSize: 14, color: 'var(--color-muted-foreground)', marginTop: 8, lineHeight: 1.55 }}>
              Pick a tool on the left, or press a key to start. Share the link to bring others in.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 18 }}>
              {shortcuts.map(([key, label]) => (
                <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 4px', borderRadius: 99, background: 'var(--color-card)', border: '1px solid var(--color-border)', fontSize: 12, color: 'var(--color-muted-foreground)' }}>
                  <kbd style={{ minWidth: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', background: 'var(--color-muted)', color: 'var(--color-foreground)', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, boxShadow: 'inset 0 -1px 0 var(--color-border-strong)' }}>{key}</kbd>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
