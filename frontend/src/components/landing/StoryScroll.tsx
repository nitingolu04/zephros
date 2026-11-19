import { useRef, useState } from 'react'
import { motion, AnimatePresence, useScroll, useMotionValueEvent, useTransform, useReducedMotion } from 'framer-motion'
import { MousePointer2, MicOff, Video, History, Download, Bookmark, Wand2 } from 'lucide-react'
import { EASE, container } from './motion'

const steps = [
  {
    kicker: '01 — Draw',
    title: 'Sketch freely. It tidies up for you.',
    body: 'Pen, highlighter, shapes, sticky notes, text and frames. Turn on Smart Shapes and a wobbly circle becomes a clean one the moment you lift the pen.',
  },
  {
    kicker: '02 — Collaborate',
    title: 'Everyone on the same canvas, live.',
    body: 'Share one link. Live cursors, presence and every edit sync instantly, with ordered writes on the server so nobody overwrites anybody.',
  },
  {
    kicker: '03 — Talk & present',
    title: 'Voice, video and screen share built in.',
    body: 'Hop on a call without leaving the board. Share your screen in a side panel, point with the laser, and react with emoji right on the canvas.',
  },
  {
    kicker: '04 — Keep',
    title: 'Save boards, rewind versions, export.',
    body: 'Save the boards that matter to your dashboard. Snapshot versions as you go and restore any of them, then export to PNG, PDF or JSON.',
  },
]

function SceneFrame({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -24, scale: 0.98 }}
      transition={{ duration: 0.55, ease: EASE }}
      className="canvas-grid"
      style={{ position: 'absolute', inset: 0, borderRadius: 16, overflow: 'hidden' }}
    >
      {children}
    </motion.div>
  )
}

function DrawScene() {
  return (
    <SceneFrame>
      <svg viewBox="0 0 600 450" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden>
        {/* Wobbly hand-drawn circle morphs into a perfect circle */}
        <motion.path
          fill="none" stroke="var(--color-accent)" strokeWidth="5" strokeLinecap="round"
          initial={{ d: 'M300 120 C 380 112, 418 180, 404 236 C 392 300, 330 330, 284 322 C 214 312, 186 250, 198 196 C 210 140, 262 124, 312 128' }}
          animate={{ d: ['M300 120 C 380 112, 418 180, 404 236 C 392 300, 330 330, 284 322 C 214 312, 186 250, 198 196 C 210 140, 262 124, 312 128', 'M300 125 C 361 125, 400 164, 400 225 C 400 286, 361 325, 300 325 C 239 325, 200 286, 200 225 C 200 164, 239 125, 300 125'] }}
          transition={{ delay: 1.1, duration: 0.6, ease: EASE }}
        />
        <motion.path
          d="M300 120 C 380 112, 418 180, 404 236 C 392 300, 330 330, 284 322 C 214 312, 186 250, 198 196 C 210 140, 262 124, 312 128"
          fill="none" stroke="var(--color-accent)" strokeWidth="5" strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 1 }} animate={{ pathLength: 1, opacity: 0 }}
          transition={{ pathLength: { duration: 1, ease: 'easeInOut' }, opacity: { delay: 1.1, duration: 0.01 } }}
        />
        <motion.rect x="70" y="300" width="140" height="90" rx="10" fill="var(--color-note-sky)" stroke="#2563EB" strokeWidth="3"
          initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.3, type: 'spring', stiffness: 200, damping: 16 }} style={{ transformOrigin: '140px 345px' }} />
        <motion.path d="M440 90 L540 60" stroke="var(--color-foreground)" strokeWidth="4" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.5, duration: 0.5 }} />
      </svg>
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5, duration: 0.4 }}
        style={{ position: 'absolute', left: '50%', top: '78%', translateX: '-50%', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 99, background: 'var(--color-ink)', color: 'var(--color-ink-foreground)', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}
      >
        <Wand2 style={{ width: 14, height: 14 }} /> Smart shape: circle
      </motion.div>
    </SceneFrame>
  )
}

function LiveScene() {
  const people = [
    { name: 'Meera', color: '#D9480F', x: ['20%', '42%', '30%'], y: ['30%', '22%', '40%'] },
    { name: 'Arjun', color: '#2563EB', x: ['70%', '58%', '66%'], y: ['24%', '50%', '38%'] },
    { name: 'Riya', color: '#15803D', x: ['46%', '62%', '40%'], y: ['72%', '64%', '58%'] },
  ]
  return (
    <SceneFrame>
      {[['var(--color-note-yellow)', 'Ideas', '14%', '18%'], ['var(--color-note-mint)', 'Owners', '58%', '16%'], ['var(--color-note-pink)', 'Risks', '34%', '58%']].map(([bg, label, left, top], i) => (
        <motion.div key={label} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 * i, type: 'spring', stiffness: 220, damping: 18 }}
          style={{ position: 'absolute', left, top, width: '26%', padding: '14px 16px', borderRadius: 6, background: bg, color: '#3D2E14', fontWeight: 500, fontSize: 14, boxShadow: '0 8px 18px rgba(24,24,27,0.10)' }}>
          {label}
          <div style={{ height: 6, width: '70%', borderRadius: 4, background: 'rgba(61,46,20,0.18)', marginTop: 10 }} />
          <div style={{ height: 6, width: '45%', borderRadius: 4, background: 'rgba(61,46,20,0.18)', marginTop: 6 }} />
        </motion.div>
      ))}
      {people.map((p, i) => (
        <motion.div key={p.name} style={{ position: 'absolute' }}
          initial={{ left: p.x[0], top: p.y[0], opacity: 0 }}
          animate={{ left: p.x, top: p.y, opacity: 1 }}
          transition={{ duration: 5, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut', delay: i * 0.3, opacity: { duration: 0.3 } }}>
          <MousePointer2 style={{ width: 18, height: 18, color: p.color, fill: p.color }} strokeWidth={1.5} />
          <span style={{ marginLeft: 12, padding: '3px 8px', borderRadius: 99, background: p.color, color: '#fff', fontSize: 11, fontWeight: 500 }}>{p.name}</span>
        </motion.div>
      ))}
      <div className="canvas-controls" style={{ position: 'absolute', right: 14, top: 14, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, fontWeight: 500 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: '#15803D' }} /> 3 online
      </div>
    </SceneFrame>
  )
}

function CallScene() {
  return (
    <SceneFrame>
      <div style={{ position: 'absolute', inset: '12% 34% 12% 6%', borderRadius: 12, background: 'var(--color-card)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-md)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)' }}>Meera is sharing their screen</span>
        <div style={{ flex: 1, borderRadius: 8, background: 'var(--color-muted)', position: 'relative', overflow: 'hidden' }}>
          {[30, 55, 40, 70, 48].map((h, i) => (
            <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: 0.2 + i * 0.08, duration: 0.6, ease: EASE }}
              style={{ position: 'absolute', bottom: 10, left: `${12 + i * 16}%`, width: '10%', borderRadius: 4, background: i === 3 ? 'var(--color-accent)' : 'var(--color-border-strong)' }} />
          ))}
          <motion.div aria-hidden animate={{ left: ['30%', '60%', '66%', '40%'], top: ['30%', '20%', '50%', '40%'] }} transition={{ duration: 4, repeat: Infinity, repeatType: 'mirror' }}
            style={{ position: 'absolute', width: 14, height: 14, borderRadius: 99, background: '#DC2626', boxShadow: '0 0 0 6px rgba(220,38,38,0.2)' }} />
        </div>
      </div>
      <div style={{ position: 'absolute', right: '6%', top: '12%', bottom: '12%', width: '24%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[['#D9480F', 'MK', false], ['#2563EB', 'AS', true], ['#15803D', 'RJ', false]].map(([c, t, muted], i) => (
          <motion.div key={t as string} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 * i, duration: 0.5, ease: EASE }}
            style={{ flex: 1, borderRadius: 10, background: 'var(--color-ink)', position: 'relative', display: 'grid', placeItems: 'center' }}>
            <span style={{ width: 34, height: 34, borderRadius: 99, background: c as string, color: '#fff', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{t as string}</span>
            <span style={{ position: 'absolute', left: 8, bottom: 6, color: 'var(--color-ink-foreground)', opacity: 0.8 }}>
              {muted ? <MicOff style={{ width: 12, height: 12 }} /> : <Video style={{ width: 12, height: 12 }} />}
            </span>
          </motion.div>
        ))}
      </div>
      {['👍', '🎉', '🔥'].map((emoji, i) => (
        <motion.span key={emoji} aria-hidden initial={{ opacity: 0, y: 0 }} animate={{ opacity: [0, 1, 0], y: -80 }} transition={{ delay: 0.6 + i * 0.7, duration: 2.2, repeat: Infinity, repeatDelay: 1.4 }}
          style={{ position: 'absolute', left: `${22 + i * 14}%`, bottom: '16%', fontSize: 26 }}>{emoji}</motion.span>
      ))}
    </SceneFrame>
  )
}

function KeepScene() {
  const versions = [['Just now', 'Launch plan finalised', 24], ['12 min ago', 'Added risks column', 19], ['40 min ago', 'First draft', 11]] as const
  return (
    <SceneFrame>
      <div className="panel" style={{ position: 'absolute', inset: '7% 10%', padding: 16, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <History style={{ width: 16, height: 16 }} /> <span className="panel-title">Version history</span>
        </div>
        {versions.map(([when, label, count], i) => (
          <motion.div key={when} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.12, duration: 0.5, ease: EASE }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 10, border: '1px solid var(--color-border)', background: i === 0 ? 'var(--color-accent-soft)' : 'transparent' }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: i === 0 ? 'var(--color-accent)' : 'var(--color-border-strong)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
              <div className="panel-subtle">{when} · {count} items</div>
            </div>
            {i > 0 && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-accent)' }}>Restore</span>}
          </motion.div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          {[[Bookmark, 'Saved'], [Download, 'PNG · PDF · JSON']].map(([Icon, text]) => {
            const I = Icon as typeof Bookmark
            return <span key={text as string} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 99, background: 'var(--color-muted)', fontSize: 12 }}><I style={{ width: 13, height: 13 }} />{text as string}</span>
          })}
        </div>
      </div>
    </SceneFrame>
  )
}

const scenes = [DrawScene, LiveScene, CallScene, KeepScene]

export default function StoryScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const [active, setActive] = useState(0)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  useMotionValueEvent(scrollYProgress, 'change', v => setActive(Math.min(steps.length - 1, Math.max(0, Math.floor(v * steps.length)))))
  const bar = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])
  const Scene = scenes[active]

  return (
    <section id="product" aria-label="How Zephros works">
      {/* Desktop: pinned scroll story */}
      <div ref={ref} className="hidden md:block" style={{ height: `${steps.length * (reduce ? 70 : 100)}vh`, position: 'relative' }}>
        <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', alignItems: 'center' }}>
          <div style={{ ...container(1160), display: 'grid', gridTemplateColumns: '0.9fr 1.1fr', gap: 64, alignItems: 'center' }}>
            <div>
              <span className="eyebrow">How it works</span>
              <div style={{ position: 'relative', marginTop: 'min(28px, 3vh)', paddingLeft: 24 }}>
                <div style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 2, background: 'var(--color-border)', borderRadius: 2 }}>
                  <motion.div style={{ width: '100%', height: bar, background: 'var(--color-accent)', borderRadius: 2 }} />
                </div>
                {steps.map((step, i) => (
                  <motion.div key={step.kicker} animate={{ opacity: i === active ? 1 : 0.38 }} transition={{ duration: 0.4 }} style={{ padding: 'min(14px, 1.6vh) 0' }}>
                    <div style={{ fontSize: 13, color: 'var(--color-muted-foreground)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>{step.kicker}</div>
                    <h3 style={{ fontSize: 'clamp(18px, min(2.2vw, 3.4vh), 28px)', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.2 }}>{step.title}</h3>
                    <AnimatePresence initial={false}>
                      {i === active && (
                        <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: EASE }}
                          style={{ overflow: 'hidden', color: 'var(--color-muted-foreground)', fontSize: 'clamp(14px, 2.2vh, 16px)', lineHeight: 1.6, maxWidth: 440 }}>
                          <span style={{ display: 'block', paddingTop: 10 }}>{step.body}</span>
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </div>
            </div>
            <div style={{ position: 'relative', aspectRatio: '4 / 3', maxHeight: '78vh', borderRadius: 20, border: '1px solid var(--color-border)', background: 'var(--color-card)', padding: 10, boxShadow: 'var(--shadow-xl)' }}>
              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <AnimatePresence mode="wait"><Scene key={active} /></AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: simple stacked steps */}
      <div className="md:hidden" style={{ ...container(), padding: '72px 16px', display: 'flex', flexDirection: 'column', gap: 48 }}>
        <span className="eyebrow">How it works</span>
        {steps.map((step, i) => {
          const MobileScene = scenes[i]
          return (
            <div key={step.kicker}>
              <div style={{ fontSize: 13, color: 'var(--color-muted-foreground)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>{step.kicker}</div>
              <h3 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.2, marginBottom: 10 }}>{step.title}</h3>
              <p style={{ color: 'var(--color-muted-foreground)', lineHeight: 1.6, marginBottom: 20 }}>{step.body}</p>
              <div style={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: 16, border: '1px solid var(--color-border)', background: 'var(--color-card)', padding: 8 }}>
                <div style={{ position: 'relative', width: '100%', height: '100%' }}><MobileScene /></div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
