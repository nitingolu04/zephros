import { useEffect, useRef, type ReactNode, type CSSProperties } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import Lenis from 'lenis'

export const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Inertial smooth scrolling for marketing pages only.
 * The board page never mounts this, so canvas panning/zooming is unaffected.
 */
export function useSmoothScroll() {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (reduce) return
    const lenis = new Lenis({ duration: 1.1, easing: t => 1 - Math.pow(1 - t, 3), smoothWheel: true, anchors: { offset: -72 } })
    let frame = 0
    const raf = (time: number) => { lenis.raf(time); frame = requestAnimationFrame(raf) }
    frame = requestAnimationFrame(raf)
    return () => { cancelAnimationFrame(frame); lenis.destroy() }
  }, [reduce])
}

interface RevealProps {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
  style?: CSSProperties
  as?: 'div' | 'section' | 'li' | 'h2' | 'p'
}

/** Fades and lifts content into place the first time it scrolls into view. */
export function Reveal({ children, delay = 0, y = 28, className, style, as = 'div' }: RevealProps) {
  const reduce = useReducedMotion()
  const Component = motion[as]
  return (
    <Component
      className={className}
      style={style}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </Component>
  )
}

/** Headline that reveals word by word. */
export function WordReveal({ text, className, style, delay = 0 }: { text: string; className?: string; style?: CSSProperties; delay?: number }) {
  const reduce = useReducedMotion()
  // Observe the visible wrapper: the words start clipped by overflow:hidden,
  // so an observer on the words themselves would never report them in view.
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const words = text.split(' ')
  return (
    <span ref={ref} className={className} style={{ display: 'inline', ...style }}>
      {words.map((word, i) => (
        <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', paddingBottom: '0.08em', marginBottom: '-0.08em' }}>
          <motion.span
            style={{ display: 'inline-block' }}
            initial={reduce ? false : { y: '110%' }}
            animate={inView || reduce ? { y: 0 } : undefined}
            transition={{ duration: 0.9, delay: delay + i * 0.06, ease: EASE }}
          >
            {word}{i < words.length - 1 ? ' ' : ''}
          </motion.span>
        </span>
      ))}
    </span>
  )
}

export const container = (max = 1120): CSSProperties => ({
  width: '100%', maxWidth: max, marginInline: 'auto', paddingInline: 'clamp(16px, 4vw, 32px)',
})
