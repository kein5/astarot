// A term with a short explanation: <Term tip="A file format for AI models">GGUF</Term>.
// The explanation shows while a mouse is over the term or the term has keyboard focus. A tap, or
// Enter, opens and closes it. Esc, or a tap elsewhere, closes it. TermTooltip.tsx draws the bubble.
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { TOOLTIP_ID, hideTip, isOpenFor, newOwner, showTip, useTooltip } from '../lib/tooltip'
import styles from './Term.module.css'

export default function Term({ tip, children }: { tip: string; children?: ReactNode }) {
  const [owner] = useState(newOwner)
  const element = useRef<HTMLButtonElement | null>(null)
  const hover = useRef(false)
  // The state when the press began: a tap focuses the term (which opens it) before its click.
  const press = useRef({ type: '', open: false })
  const tooltip = useTooltip()

  const show = () => element.current && showTip(owner, tip, element.current)
  const hide = () => hideTip(owner)

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (isOpenFor(owner) && element.current && !element.current.contains(event.target as Node)) hide()
    }
    // Esc closes the explanation whether it opened by mouse, focus or tap.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpenFor(owner)) hide()
    }
    const onScroll = () => hide()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', onKey)
    addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', onKey)
      removeEventListener('scroll', onScroll)
      hide()
    }
  }, [owner])

  return (
    <button
      ref={element}
      type="button"
      className={styles.term}
      aria-describedby={tooltip.open && tooltip.owner === owner ? TOOLTIP_ID : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return
        hover.current = true
        show()
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return
        hover.current = false
        if (document.activeElement !== element.current) hide()
      }}
      onPointerDown={(event) => {
        press.current = { type: event.pointerType, open: isOpenFor(owner) }
      }}
      onFocus={show}
      onBlur={() => {
        if (!hover.current) hide()
      }}
      onClick={(event) => {
        // Enter or Space on the focused term.
        if (event.detail === 0) return isOpenFor(owner) ? hide() : show()
        if (press.current.type === 'mouse') return show()
        return press.current.open ? hide() : show()
      }}
    >
      {children}
    </button>
  )
}
