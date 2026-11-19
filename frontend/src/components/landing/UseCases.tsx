import { useLayoutEffect, useRef, useState } from 'react'
import { motion, useScroll, useTransform, useSpring, useReducedMotion } from 'framer-motion'
import { GraduationCap, Rocket, Users, PenTool, BookOpen } from 'lucide-react'
import { container } from './motion'

const cases = [
  { icon: GraduationCap, title: 'Classrooms', body: 'Teach on one board, let students annotate, and save the lesson for revision.', note: 'var(--color-note-yellow)' },
  { icon: Rocket, title: 'Sprint planning', body: 'Map goals, owners and risks with stickies while the team talks on the built-in call.', note: 'var(--color-note-mint)' },
  { icon: Users, title: 'Remote interviews', body: 'Whiteboard a system design together. Lock the board so only invited people can join.', note: 'var(--color-note-sky)' },
  { icon: PenTool, title: 'Design critiques', body: 'Share your screen, point with the laser, and drop reactions right where they matter.', note: 'var(--color-note-pink)' },
  { icon: BookOpen, title: 'Study groups', body: 'Work through problems together, chat with @mentions, and export notes as PDF.', note: 'var(--color-note-yellow)' },
]

function Card({ c, index }: { c: typeof cases[number]; index: number }) {
  return (
    <article style={{
      flexShrink: 0, width: 'min(380px, 80vw)', minHeight: 'min(340px, 52vh)', borderRadius: 20, padding: 28,
      background: 'var(--color-card)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-md)',
      display: 'flex', flexDirection: 'column', gap: 14, position: 'relative', overflow: 'hidden',
    }}>
      <span style={{ position: 'absolute', right: -24, top: -24, width: 120, height: 120, borderRadius: 18, background: c.note, transform: `rotate(${index % 2 ? 10 : -8}deg)`, opacity: 0.9 }} />
      <span style={{ position: 'relative', width: 44, height: 44, borderRadius: 12, background: 'var(--color-ink)', color: 'var(--color-ink-foreground)', display: 'grid', placeItems: 'center' }}>
        <c.icon style={{ width: 20, height: 20 }} />
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)', marginTop: 'auto' }}>0{index + 1}</span>
      <h3 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.025em' }}>{c.title}</h3>
      <p style={{ color: 'var(--color-muted-foreground)', lineHeight: 1.6 }}>{c.body}</p>
    </article>
  )
}

export default function UseCases() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const [distance, setDistance] = useState(0)

  useLayoutEffect(() => {
    const measure = () => {
      const track = trackRef.current
      if (track) setDistance(Math.max(0, track.scrollWidth - window.innerWidth + 48))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] })
  const smooth = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 })
  const x = useTransform(smooth, [0, 1], [0, -distance])

  const heading = (
    <div style={{ ...container(), marginBottom: 40 }}>
      <span className="eyebrow">Use cases</span>
      <h2 style={{ fontSize: 'clamp(32px, 4.4vw, 56px)', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.05, marginTop: 16, maxWidth: 720 }}>
        One canvas, <span className="font-display" style={{ fontStyle: 'italic' }}>a hundred</span> ways to use it.
      </h2>
    </div>
  )

  if (reduce) {
    return (
      <section id="use-cases" style={{ padding: '120px 0' }}>
        {heading}
        <div style={{ ...container(), display: 'flex', gap: 20, overflowX: 'auto', paddingBottom: 12 }}>
          {cases.map((c, i) => <Card key={c.title} c={c} index={i} />)}
        </div>
      </section>
    )
  }

  return (
    <section id="use-cases" ref={sectionRef} style={{ height: `calc(100vh + ${distance}px)`, position: 'relative' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
        {heading}
        <motion.div ref={trackRef} style={{ x, display: 'flex', gap: 20, paddingInline: 'max(16px, calc((100vw - 1120px) / 2 + 32px))', width: 'max-content' }}>
          {cases.map((c, i) => <Card key={c.title} c={c} index={i} />)}
        </motion.div>
      </div>
    </section>
  )
}
