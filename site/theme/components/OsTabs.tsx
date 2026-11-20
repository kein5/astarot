// Steps that differ between Windows and Linux, as a segmented control:
//
//   <OsTabs>
//   <OsTab os="windows">
//
//   …Markdown for Windows…
//
//   </OsTab>
//   <OsTab os="linux">
//
//   …Markdown for Linux…
//
//   </OsTab>
//   </OsTabs>
//
// Leave a blank line inside each <OsTab> so the Markdown in it is read as blocks. Both panels are
// in the built page (search finds either); the one for the reader's OS shows.
import { Children, type KeyboardEvent, type ReactElement, type ReactNode, isValidElement, useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { type Os, chooseOs, useOs } from '../lib/os'
import styles from './OsTabs.module.css'

const TABS: { id: Os; label: string }[] = [
  { id: 'windows', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
]

export default function OsTabs({ children }: { children?: ReactNode }) {
  const os = useOs()
  const base = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [thumb, setThumb] = useState({ x: 0, width: 0 })
  const panels = new Map<Os, ReactNode>()
  Children.forEach(children, (child) => {
    if (isValidElement(child) && (child as ReactElement<{ os?: Os }>).props.os) {
      const element = child as ReactElement<{ os: Os; children?: ReactNode }>
      panels.set(element.props.os, element.props.children)
    }
  })

  const measure = useCallback(() => {
    const button = buttons.current[TABS.findIndex((tab) => tab.id === os)]
    if (button) setThumb({ x: button.offsetLeft, width: button.offsetWidth })
  }, [os])

  useLayoutEffect(() => {
    measure()
    addEventListener('resize', measure)
    return () => removeEventListener('resize', measure)
  }, [measure])

  function onKey(event: KeyboardEvent) {
    const index = TABS.findIndex((tab) => tab.id === os)
    const step = ({ ArrowRight: 1, ArrowLeft: -1, Home: -index, End: TABS.length - 1 - index } as Record<string, number>)[event.key]
    if (step === undefined) return
    event.preventDefault()
    const next = (index + step + TABS.length) % TABS.length
    chooseOs(TABS[next].id)
    requestAnimationFrame(() => buttons.current[next]?.focus())
  }

  return (
    <div className={styles.osTabs}>
      <div className={styles.segmented} role="tablist" aria-label="OS" onKeyDown={onKey}>
        <span
          className={styles.thumb}
          style={{ transform: `translateX(${thumb.x}px)`, width: `${thumb.width}px`, opacity: thumb.width ? 1 : 0 }}
          aria-hidden="true"
        />
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[index] = element
            }}
            id={`${base}-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={os === tab.id}
            aria-controls={`${base}-${tab.id}`}
            tabIndex={os === tab.id ? 0 : -1}
            onClick={() => chooseOs(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.id}
          id={`${base}-${tab.id}`}
          className={styles.panel}
          role="tabpanel"
          aria-labelledby={`${base}-${tab.id}-tab`}
          hidden={os !== tab.id}
        >
          {panels.get(tab.id)}
        </div>
      ))}
    </div>
  )
}
