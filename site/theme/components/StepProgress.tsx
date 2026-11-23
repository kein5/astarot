// Where the reader is in a page of numbered steps (`## 1. …`, `## 2. …`). Put <StepProgress /> before
// the first step. It shows the steps with their names there; once that has scrolled away, a slim
// bar under the navigation keeps the dots and the name of the step being read. Each step jumps to
// its heading. The steps come from the page's headings in its data, so the list is in the built
// page. The slim bar takes no room in the page, so nothing moves when it appears.
// Both opt out of the page's list styles (`rp-not-doc`): the page puts a top margin on every list
// item but the first, which set the first step higher than the others.
import { useLang, usePage } from '@rspress/core/runtime'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import styles from './StepProgress.module.css'

const STEP = /^\s*(\d+)[.．]\s*/
// The slim bar's height (keep in step with .dockBar in the CSS).
const DOCK = 44

function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

export default function StepProgress() {
  const { page } = usePage()
  const label = useLang() === 'ja' ? '手順' : 'Steps'
  const steps = (page.toc ?? [])
    .filter((heading) => heading.depth === 2 && STEP.test(heading.text))
    // The number is shown in the dot.
    .map((heading) => ({ id: heading.id, label: heading.text.replace(STEP, '').trim() }))

  const full = useRef<HTMLElement | null>(null)
  const [current, setCurrent] = useState(-1)
  const [top, setTop] = useState(64)
  const [docked, setDocked] = useState(false)

  useEffect(() => {
    let frame = 0
    function update() {
      frame = 0
      const nav = document.querySelector('.rp-nav')?.getBoundingClientRect().bottom ?? 64
      const menu = document.querySelector('.rp-doc-layout__menu')?.getBoundingClientRect()
      const bar = Math.max(nav, menu && menu.height ? menu.bottom : 0)
      setTop(bar)
      setDocked((full.current?.getBoundingClientRect().bottom ?? Infinity) < bar)
      // The step being read: the last heading that has passed under the bars. At the end of the
      // page the last headings cannot reach that line; the lowest one in sight counts.
      const end = scrollY + innerHeight >= document.documentElement.scrollHeight - 2
      const line = end ? innerHeight : bar + DOCK + 48
      let index = -1
      steps.forEach((step, i) => {
        const heading = document.getElementById(step.id)
        if (heading && heading.getBoundingClientRect().top <= line) index = i
      })
      setCurrent(index)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    addEventListener('scroll', schedule, { passive: true })
    addEventListener('resize', schedule)
    return () => {
      removeEventListener('scroll', schedule)
      removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [page.routePath, steps.length])

  if (!steps.length) return null

  const progress = steps.length > 1 ? Math.max(0, current) / (steps.length - 1) : 0
  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView()
    history.replaceState(history.state, '', `#${encodeURIComponent(id)}`)
  }
  const state = (index: number) => (index < current ? styles.done : index === current ? styles.current : undefined)

  return (
    <>
      <nav ref={full} className={`${styles.stepProgress} rp-not-doc`} aria-label={label}>
        <ol style={{ '--progress': progress, '--count': steps.length } as CSSProperties}>
          {steps.map((step, index) => (
            <li key={step.id} className={state(index)}>
              <a href={`#${step.id}`} aria-current={index === current ? 'step' : undefined}>
                <span className={styles.dot} aria-hidden="true">
                  {index < current ? <Check /> : index + 1}
                </span>
                <span className={styles.name}>{step.label}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className={`${styles.stepDock} rp-not-doc`} style={{ top: `${top}px` }} aria-hidden="true">
        <div className={[styles.dockBar, docked && styles.shown].filter(Boolean).join(' ')}>
          <ol>
            {steps.map((step, index) => (
              <li key={step.id} className={state(index)} title={`${index + 1}. ${step.label}`} onClick={() => jump(step.id)}>
                <span className={styles.dot}>{index < current ? <Check /> : index + 1}</span>
              </li>
            ))}
          </ol>
          <p className={styles.now}>{current >= 0 ? `${current + 1}. ${steps[current].label}` : ''}</p>
        </div>
      </div>
    </>
  )
}
