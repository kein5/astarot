// The bubble for every <Term>. It sits above the term (below it near the top of the window),
// slides to the next term and fades its words, with no movement under prefers-reduced-motion.
import { useLayoutEffect, useRef, useState } from 'react'
import { TOOLTIP_ID, useTooltip } from '../lib/tooltip'
import styles from './TermTooltip.module.css'

const MARGIN = 8

export function TermTooltip() {
  const tooltip = useTooltip()
  const bubble = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  // Opening from hidden places the bubble at once; only a move between terms slides.
  const [jumping, setJumping] = useState(false)
  const wasOpen = useRef(false)

  // The size follows the bubble itself: its words change only after the old ones have faded out.
  useLayoutEffect(() => {
    const element = bubble.current
    if (!element) return
    const measure = () => setSize({ width: element.offsetWidth, height: element.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (tooltip.open && !wasOpen.current) {
      setJumping(true)
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setJumping(false)))
      wasOpen.current = true
      return () => cancelAnimationFrame(frame)
    }
    if (!tooltip.open) wasOpen.current = false
  }, [tooltip.open])

  const { left, top, width, height } = tooltip.rect
  const viewport = typeof window === 'undefined' ? 1024 : document.documentElement.clientWidth
  const x = Math.min(Math.max(MARGIN, left + width / 2 - size.width / 2), viewport - size.width - MARGIN)
  const below = top - size.height - MARGIN < 72
  const y = below ? top + height + MARGIN : top - size.height - MARGIN
  const classes = [styles.tooltip, tooltip.open && styles.open, below && styles.below, jumping && styles.jump]

  return (
    <div
      id={TOOLTIP_ID}
      ref={bubble}
      role="tooltip"
      className={classes.filter(Boolean).join(' ')}
      style={{ transform: `translate(${x}px, ${y}px)`, ['--arrow' as string]: `${left + width / 2 - x}px` }}
    >
      {/* A new term's words fade in where the last ones were. */}
      <span key={tooltip.owner} className={styles.words}>
        {tooltip.text}
      </span>
    </div>
  )
}
