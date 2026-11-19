import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence, useInView, useReducedMotion, animate } from 'framer-motion'
import {
  ArrowRight, ArrowUpRight, Plus, Minus, Wand2, History, Mic, MonitorUp, MessageSquare, Lock, Download, Layers,
  MousePointer2, Pencil, StickyNote, Shapes, Frame, Highlighter, Laugh, Type,
} from 'lucide-react'
import { toast } from 'sonner'
import Navbar from '@/components/layout/Navbar'
import Logo from '@/components/ui/Logo'
import HeroBoard from '@/components/landing/HeroBoard'
import StoryScroll from '@/components/landing/StoryScroll'
import UseCases from '@/components/landing/UseCases'
import { Reveal, WordReveal, useSmoothScroll, container, EASE } from '@/components/landing/motion'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'

const marquee = [
  [Pencil, 'Pen & marker'], [Highlighter, 'Highlighter'], [Shapes, 'Shapes'], [StickyNote, 'Sticky notes'],
  [Type, 'Rich text'], [Frame, 'Frames'], [MousePointer2, 'Live cursors'], [Laugh, 'Reactions'],
  [Mic, 'Voice & video'], [MonitorUp, 'Screen share'], [MessageSquare, 'Chat'], [Download, 'Export'],
] as const

const features = [
  { icon: Layers, title: 'Real-time canvas', body: 'Every stroke, shape and sticky syncs to everyone on the board instantly, with presence and live cursors.', span: 2, tone: 'var(--color-note-yellow)' },
  { icon: Wand2, title: 'Smart Shapes', body: 'Draw a rough box, circle or line and it snaps into a clean shape.', badge: 'New', tone: 'var(--color-note-sky)' },
  { icon: History, title: 'Version history', body: 'Snapshot a board and restore any earlier version in one click.', badge: 'New', tone: 'var(--color-note-mint)' },
  { icon: Mic, title: 'Voice & video', body: 'Opt-in mic and camera on every board. No extra app.', tone: 'var(--color-note-pink)' },
  { icon: MonitorUp, title: 'Screen share', body: 'A resizable side panel with laser pointer and reactions.', tone: 'var(--color-note-sky)' },
  { icon: MessageSquare, title: 'Chat that sticks', body: '@mentions, emoji reactions, and history kept on your device.', tone: 'var(--color-note-yellow)' },
  { icon: Lock, title: 'Private boards', body: 'Add a password, require sign-in, or lock the room once everyone has arrived.', span: 2, tone: 'var(--color-note-mint)' },
]

const stats = [
  { value: 13, label: 'canvas tools' },
  { value: 3, label: 'pen styles' },
  { value: 1, label: 'link to invite' },
  { value: 0, label: 'installs needed' },
]

const faqs = [
  { q: 'Do I need an account?', a: 'No. Anyone can create or join a temporary board. Sign in with Google to save boards and find them later on your dashboard.' },
  { q: 'How long do boards last?', a: 'Temporary boards are cleaned up a couple of minutes after the last person leaves. Saved boards stay until the owner deletes them.' },
  { q: 'Can I keep a board private?', a: 'Yes. The owner can set a password, require Google sign-in, or lock the board so no new participants can join.' },
  { q: 'Where is version history kept?', a: 'On the server, with the board. Versions are saved automatically every few minutes while people work, and restoring one updates the live board for everyone.' },
  { q: 'Can I export my work?', a: 'Export the canvas as PNG, PDF or JSON, record the session, and optionally upload recordings to Google Drive.' },
  { q: 'How many people can join?', a: 'Zephros is built for small teams, classes and study groups — it works well with up to about 20 people on a board.' },
]

function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10%' })
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!inView || !ref.current) return
    if (reduce) { ref.current.textContent = String(to); return }
    const controls = animate(0, to, { duration: 1.4, ease: EASE, onUpdate: v => { if (ref.current) ref.current.textContent = String(Math.round(v)) } })
    return () => controls.stop()
  }, [inView, to, reduce])
  return <span ref={ref}>0</span>
}

function parseBoardId(input: string) {
  const value = input.trim()
  if (!value.includes('/board/')) return value
  return value.split('/board/').pop()?.split(/[?#]/)[0] || ''
}

export default function LandingPage() {
  useSmoothScroll()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const user = useAuthStore(s => s.user)
  const [joinId, setJoinId] = useState('')
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [creating, setCreating] = useState(false)

  const handleCreate = useCallback(async () => {
    if (creating) return
    setCreating(true)
    const res = await api.createBoard()
    setCreating(false)
    if (res.success && res.data) {
      if (user) api.recordBoardVisit(res.data.boardId, 'Untitled Board').catch(() => {})
      toast.success('Board created')
      navigate(`/board/${res.data.boardId}`)
    } else {
      toast.error(res.error || 'Failed to create board — the server may be waking up, try again')
    }
  }, [creating, navigate, user])

  useEffect(() => {
    if (searchParams.get('action') === 'create' && user) {
      handleCreate()
      navigate('/', { replace: true })
    }
  }, [searchParams, user, handleCreate, navigate])

  const handleJoin = (e?: React.FormEvent) => {
    e?.preventDefault()
    const boardId = parseBoardId(joinId)
    if (!boardId) { toast.error('Paste a board link or ID'); return }
    navigate(`/board/${boardId}`)
  }

  const createButton = (size: 'btn-lg' | '' = 'btn-lg') => (
    <button type="button" onClick={handleCreate} disabled={creating} className={`btn btn-primary ${size}`}>
      {creating
        ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        : <>Start a board <ArrowRight style={{ width: 18, height: 18 }} /></>}
    </button>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background)', overflowX: 'clip' }}>
      <Navbar />

      {/* ── Hero ── */}
      <section style={{ position: 'relative', paddingTop: 'clamp(120px, 16vh, 168px)', paddingBottom: 64 }}>
        <div aria-hidden className="dot-grid" style={{ position: 'absolute', inset: 0, opacity: 0.55, maskImage: 'radial-gradient(ellipse 70% 55% at 50% 30%, #000 30%, transparent 75%)', WebkitMaskImage: 'radial-gradient(ellipse 70% 55% at 50% 30%, #000 30%, transparent 75%)' }} />
        <div style={{ ...container(1120), position: 'relative', textAlign: 'center' }}>
          <motion.a href="#features" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 14px', borderRadius: 999, border: '1px solid var(--color-border)', background: 'var(--color-card)', fontSize: 13, color: 'var(--color-foreground)', textDecoration: 'none', boxShadow: 'var(--shadow-sm)' }}>
            New: Smart Shapes & version history
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, background: 'var(--color-muted)', fontSize: 12 }}>See what's new <ArrowUpRight style={{ width: 12, height: 12 }} /></span>
          </motion.a>

          <h1 className="text-balance" style={{ fontSize: 'clamp(44px, 7.6vw, 104px)', fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 0.98, margin: '28px auto 0', maxWidth: 980 }}>
            <WordReveal text="Think together," delay={0.1} />{' '}
            <span className="font-display" style={{ fontStyle: 'italic', fontWeight: 400, letterSpacing: '-0.02em' }}>
              <WordReveal text="on one canvas." delay={0.3} />
            </span>
          </h1>

          <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.55, ease: EASE }}
            className="text-pretty" style={{ fontSize: 'clamp(16px, 1.5vw, 19px)', lineHeight: 1.6, color: 'var(--color-muted-foreground)', maxWidth: 560, margin: '24px auto 0' }}>
            Zephros is a real-time whiteboard with voice, video and screen share built in. Share one link and draw, talk and plan together — no install, no sign-up to start.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.7, ease: EASE }}
            style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 36 }}>
            {createButton()}
            <form onSubmit={handleJoin} style={{ display: 'flex', alignItems: 'center', height: 52, borderRadius: 999, border: '1px solid var(--color-border-strong)', background: 'var(--color-card)', padding: 4, paddingLeft: 18 }}>
              <input aria-label="Board link or ID" placeholder="Paste a board link…" value={joinId} onChange={e => setJoinId(e.target.value)}
                style={{ width: 'min(200px, 46vw)', border: 'none', background: 'transparent', outline: 'none', fontSize: 15, color: 'var(--color-foreground)' }} />
              <button type="submit" className="btn btn-ghost btn-sm" style={{ height: 42, border: 'none', background: 'var(--color-muted)' }}>Join</button>
            </form>
          </motion.div>

          <div style={{ marginTop: 'clamp(56px, 8vh, 88px)' }}>
            <HeroBoard />
          </div>
        </div>
      </section>

      {/* ── Capability marquee ── */}
      <section aria-label="Tools" className="marquee" style={{ borderBlock: '1px solid var(--color-border)', padding: '18px 0', overflow: 'hidden', maskImage: 'linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)' }}>
        <div className="marquee-track">
          {[...marquee, ...marquee].map(([Icon, label], i) => (
            <span key={i} aria-hidden={i >= marquee.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '0 28px', fontSize: 15, color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap' }}>
              <Icon style={{ width: 17, height: 17, color: 'var(--color-foreground)' }} /> {label}
            </span>
          ))}
        </div>
      </section>

      {/* ── Pinned scroll story ── */}
      <StoryScroll />

      {/* ── Bento features ── */}
      <section id="features" style={{ padding: 'clamp(88px, 12vw, 140px) 0' }}>
        <div style={container()}>
          <Reveal>
            <span className="eyebrow">Features</span>
            <h2 className="text-balance" style={{ fontSize: 'clamp(32px, 4.4vw, 56px)', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.05, marginTop: 16, maxWidth: 760 }}>
              Everything a team needs to think out loud, <span className="font-display" style={{ fontStyle: 'italic', fontWeight: 400 }}>nothing it doesn't.</span>
            </h2>
          </Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 16, marginTop: 56 }}>
            {features.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 0.08} style={{ gridColumn: f.span === 2 ? 'span 2' : undefined }} className="bento-item">
                <motion.article whileHover={{ y: -4 }} transition={{ duration: 0.25, ease: EASE }}
                  style={{ height: '100%', minHeight: 220, borderRadius: 20, padding: 28, background: 'var(--color-card)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', overflow: 'hidden' }}>
                  <span style={{ width: 44, height: 44, borderRadius: 12, background: f.tone, color: '#2B2414', display: 'grid', placeItems: 'center' }}>
                    <f.icon style={{ width: 20, height: 20 }} />
                  </span>
                  <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em' }}>{f.title}</h3>
                    {f.badge && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>{f.badge}</span>}
                  </div>
                  <p style={{ color: 'var(--color-muted-foreground)', lineHeight: 1.6, maxWidth: 460 }}>{f.body}</p>
                </motion.article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section style={{ borderBlock: '1px solid var(--color-border)', background: 'var(--color-card)' }}>
        <div style={{ ...container(), display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.08} style={{ padding: '48px 24px', borderLeft: i ? '1px solid var(--color-border)' : 'none', textAlign: 'center' }}>
              <div className="font-display" style={{ fontSize: 'clamp(56px, 7vw, 88px)', lineHeight: 1 }}><CountUp to={s.value} /></div>
              <div style={{ marginTop: 8, color: 'var(--color-muted-foreground)' }}>{s.label}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Horizontal use cases ── */}
      <UseCases />

      {/* ── FAQ ── */}
      <section id="faq" style={{ padding: 'clamp(88px, 12vw, 140px) 0', background: 'var(--color-card)', borderTop: '1px solid var(--color-border)' }}>
        <div style={{ ...container(1120), display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 48, alignItems: 'start' }}>
          <Reveal>
            <span className="eyebrow">FAQ</span>
            <h2 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.05, marginTop: 16 }}>
              Questions, <span className="font-display" style={{ fontStyle: 'italic', fontWeight: 400 }}>answered.</span>
            </h2>
            <p style={{ color: 'var(--color-muted-foreground)', marginTop: 16, lineHeight: 1.6, maxWidth: 360 }}>Everything you need to know before you start your first board.</p>
          </Reveal>
          <div>
            {faqs.map((faq, i) => {
              const open = openFaq === i
              return (
                <Reveal key={faq.q} delay={i * 0.04} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <button type="button" onClick={() => setOpenFaq(open ? null : i)} aria-expanded={open}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '22px 0', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-foreground)', fontSize: 17, fontWeight: 500, textAlign: 'left' }}>
                    {faq.q}
                    <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 99, border: '1px solid var(--color-border)', display: 'grid', placeItems: 'center' }}>
                      {open ? <Minus style={{ width: 14, height: 14 }} /> : <Plus style={{ width: 14, height: 14 }} />}
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} style={{ overflow: 'hidden' }}>
                        <p style={{ paddingBottom: 22, color: 'var(--color-muted-foreground)', lineHeight: 1.65, maxWidth: 560 }}>{faq.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section style={{ padding: 'clamp(88px, 12vw, 160px) 0' }}>
        <div style={container(960)}>
          <Reveal style={{ position: 'relative', borderRadius: 28, background: 'var(--color-ink)', color: 'var(--color-ink-foreground)', padding: 'clamp(40px, 7vw, 88px)', textAlign: 'center', overflow: 'hidden' }}>
            {[['var(--color-note-yellow)', '-4%', '-10%', -12], ['var(--color-note-pink)', '86%', '62%', 10], ['var(--color-note-mint)', '78%', '-14%', 6]].map(([bg, left, top, r], i) => (
              <motion.span key={i} aria-hidden initial={{ opacity: 0, scale: 0.6 }} whileInView={{ opacity: 0.9, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.1, type: 'spring', stiffness: 160, damping: 16 }}
                style={{ position: 'absolute', left: left as string, top: top as string, width: 120, height: 120, borderRadius: 14, background: bg as string, rotate: r as number }} />
            ))}
            <h2 style={{ position: 'relative', fontSize: 'clamp(34px, 5vw, 64px)', fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1.02 }}>
              Your next idea needs <span className="font-display" style={{ fontStyle: 'italic', fontWeight: 400 }}>a bigger page.</span>
            </h2>
            <p style={{ position: 'relative', marginTop: 18, opacity: 0.7, fontSize: 17 }}>Start a board in one click. Invite anyone with a link.</p>
            <div style={{ position: 'relative', marginTop: 32, display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" onClick={handleCreate} disabled={creating} className="btn btn-lg" style={{ background: 'var(--color-ink-foreground)', color: 'var(--color-ink)' }}>
                {creating ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <>Start a board <ArrowRight style={{ width: 18, height: 18 }} /></>}
              </button>
              {!user && (
                <button type="button" onClick={() => navigate('/login')} className="btn btn-lg" style={{ background: 'transparent', color: 'var(--color-ink-foreground)', borderColor: 'color-mix(in srgb, var(--color-ink-foreground) 30%, transparent)' }}>
                  Sign in to save boards
                </button>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid var(--color-border)', padding: '40px 0 56px' }}>
        <div style={{ ...container(), display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Logo size={26} />
            <span style={{ fontSize: 14, color: 'var(--color-muted-foreground)' }}>Real-time whiteboard for teams, classes and study groups.</span>
          </div>
          <nav style={{ display: 'flex', gap: 20, fontSize: 14 }} aria-label="Footer">
            {[['#product', 'Product'], ['#features', 'Features'], ['#use-cases', 'Use cases'], ['#faq', 'FAQ']].map(([href, label]) => (
              <a key={href} href={href} style={{ color: 'var(--color-muted-foreground)', textDecoration: 'none' }}>{label}</a>
            ))}
          </nav>
          <span style={{ fontSize: 13, color: 'var(--color-muted-foreground)', width: '100%' }}>© {new Date().getFullYear()} Zephros</span>
        </div>
      </footer>
    </div>
  )
}
