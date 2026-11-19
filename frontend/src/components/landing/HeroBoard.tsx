import { useRef } from 'react'
import { motion, useScroll, useTransform, useReducedMotion, useSpring } from 'framer-motion'
import { MousePointer2, Pencil, Square, Type, StickyNote, Hand, Mic, Video, MonitorUp, MessageSquare } from 'lucide-react'
import { EASE } from './motion'

function Cursor({ name, color, path, delay }: { name: string; color: string; path: { x: string[]; y: string[] }; delay: number }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      aria-hidden
      style={{ position: 'absolute', left: 0, top: 0, zIndex: 5, pointerEvents: 'none' }}
      initial={{ opacity: 0, left: path.x[0], top: path.y[0] }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, left: path.x, top: path.y }}
      transition={{ opacity: { delay, duration: 0.4 }, left: { delay, duration: 9, repeat: Infinity, ease: 'easeInOut' }, top: { delay, duration: 9, repeat: Infinity, ease: 'easeInOut' } }}
    >
      <MousePointer2 style={{ width: 18, height: 18, color, fill: color }} strokeWidth={1.5} />
      <span style={{ display: 'inline-block', marginLeft: 12, marginTop: -2, padding: '3px 8px', borderRadius: 999, background: color, color: '#fff', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>
        {name}
      </span>
    </motion.div>
  )
}

function Note({ color, text, style, delay, rotate }: { color: string; text: string; style: React.CSSProperties; delay: number; rotate: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6, rotate: rotate - 8 }}
      animate={{ opacity: 1, scale: 1, rotate }}
      transition={{ delay, type: 'spring', stiffness: 220, damping: 18 }}
      style={{
        position: 'absolute', padding: '12px 14px', borderRadius: 6, background: color,
        boxShadow: '0 1px 1px rgba(0,0,0,0.06), 0 8px 18px rgba(24,24,27,0.10)',
        fontSize: 'clamp(10px, 1.15vw, 14px)', fontWeight: 500, color: '#3D2E14', lineHeight: 1.35, ...style,
      }}
    >
      {text}
    </motion.div>
  )
}

/** The product shot: a live-looking board that draws itself, then flattens as you scroll. */
export default function HeroBoard() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 20%'] })
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24, mass: 0.4 })
  const rotateX = useTransform(progress, [0, 1], [reduce ? 0 : 22, 0])
  const scale = useTransform(progress, [0, 1], [reduce ? 1 : 0.9, 1])
  const y = useTransform(progress, [0, 1], [reduce ? 0 : 40, 0])

  const tools = [MousePointer2, Hand, Pencil, Square, Type, StickyNote]

  return (
    <div ref={ref} style={{ perspective: 1600, width: '100%' }}>
      <motion.div
        style={{ rotateX, scale, y, transformOrigin: '50% 0%' }}
        initial={{ opacity: 0, y: 60 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.35, ease: EASE }}
      >
        <div style={{ borderRadius: 18, border: '1px solid var(--color-border)', background: 'var(--color-card)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
          {/* Window chrome */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {['#E5E2DA', '#E5E2DA', '#E5E2DA'].map((c, i) => <span key={i} style={{ width: 10, height: 10, borderRadius: 99, background: c }} />)}
            </div>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Sprint planning</span>
            <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)' }} className="hidden sm:inline">· saved</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex' }}>
                {[['#D9480F', 'MK'], ['#2563EB', 'AS'], ['#15803D', 'RJ']].map(([c, t], i) => (
                  <span key={t} style={{ width: 24, height: 24, borderRadius: 99, background: c, color: '#fff', fontSize: 10, fontWeight: 600, display: 'grid', placeItems: 'center', border: '2px solid var(--color-card)', marginLeft: i ? -7 : 0 }}>{t}</span>
                ))}
              </div>
              <span className="hidden sm:inline-flex" style={{ height: 26, alignItems: 'center', padding: '0 10px', borderRadius: 99, background: 'var(--color-ink)', color: 'var(--color-ink-foreground)', fontSize: 12, fontWeight: 500 }}>Share</span>
            </div>
          </div>

          {/* Canvas */}
          <div className="canvas-grid" style={{ position: 'relative', aspectRatio: '16 / 9', overflow: 'hidden' }}>
            {/* Toolbar */}
            <motion.div
              initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8, duration: 0.6, ease: EASE }}
              className="floating-toolbar hidden sm:flex"
              style={{ position: 'absolute', left: 14, top: '50%', translateY: '-50%', flexDirection: 'column', gap: 2, padding: 5 }}
            >
              {tools.map((Icon, i) => (
                <span key={i} className={`toolbar-btn toolbar-btn-compact${i === 2 ? ' active' : ''}`}><Icon style={{ width: 15, height: 15 }} /></span>
              ))}
            </motion.div>

            <Note color="var(--color-note-yellow)" text="Q3 goal: ship realtime v2" delay={1.0} rotate={-3} style={{ left: '14%', top: '14%', width: '19%' }} />
            <Note color="var(--color-note-mint)" text="Interview 5 teachers" delay={1.15} rotate={2} style={{ left: '15%', top: '52%', width: '17%' }} />
            <Note color="var(--color-note-pink)" text="Fix onboarding drop-off" delay={1.3} rotate={-1.5} style={{ right: '9%', top: '18%', width: '18%' }} />
            <Note color="var(--color-note-sky)" text="Smart shapes ✓" delay={1.45} rotate={3} style={{ right: '13%', bottom: '14%', width: '15%' }} />

            {/* Hand-drawn connections that draw themselves */}
            <svg viewBox="0 0 1600 900" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden>
              <motion.path d="M560 230 C 760 160, 900 200, 1080 250" fill="none" stroke="var(--color-foreground)" strokeWidth="4" strokeLinecap="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1.7, duration: 1.1, ease: 'easeInOut' }} />
              <motion.path d="M1062 228 L1086 251 L1056 266" fill="none" stroke="var(--color-foreground)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 2.7, duration: 0.3 }} />
              <motion.rect x="640" y="430" width="360" height="200" rx="18" fill="color-mix(in srgb, var(--color-accent) 10%, transparent)" stroke="var(--color-accent)" strokeWidth="4"
                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ delay: 2.2, duration: 1.2, ease: 'easeInOut' }} />
              <motion.text x="820" y="545" textAnchor="middle" fontSize="38" fontWeight="500" fill="var(--color-foreground)" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.1, duration: 0.6 }}>
                Launch plan
              </motion.text>
              <motion.path d="M520 640 C 560 610, 600 700, 640 600" fill="none" stroke="#15803D" strokeWidth="5" strokeLinecap="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 3.3, duration: 0.8 }} />
            </svg>

            <Cursor name="Meera" color="#D9480F" delay={1.6} path={{ x: ['58%', '44%', '50%', '62%', '58%'], y: ['62%', '55%', '70%', '66%', '62%'] }} />
            <Cursor name="Arjun" color="#2563EB" delay={2.2} path={{ x: ['70%', '76%', '64%', '68%', '70%'], y: ['30%', '44%', '40%', '24%', '30%'] }} />

            {/* Call + chat dock */}
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2, duration: 0.6, ease: EASE }}
              className="canvas-controls hidden sm:flex"
              style={{ position: 'absolute', left: '50%', bottom: 14, translateX: '-50%', gap: 4, padding: 5 }}
            >
              {[Mic, Video, MonitorUp, MessageSquare].map((Icon, i) => (
                <span key={i} className="toolbar-btn toolbar-btn-compact"><Icon style={{ width: 15, height: 15 }} /></span>
              ))}
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
