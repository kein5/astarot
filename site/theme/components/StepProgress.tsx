// Where the reader is in a page of numbered steps (`## 1. …`, `## 2. …`). Put <StepProgress /> before
// the first step. It shows the steps with their names there; once that has scrolled away, a slim
// bar under the navigation keeps the dots and the name of the step being read. Each step jumps to
// its heading. The steps come from the page's headings in its data, so the list is in the built
// page. The slim bar takes no room in the page, so nothing moves when it appears. It is fixed to
// the window under the bars at the top, over the column of the list: a sticky bar would stick to
// the page's own box (`.rp-doc-layout__doc`, which has `overflow: auto` and never scrolls itself)
// and scroll away with the page.
// Both opt out of the page's list styles (`rp-not-doc`): the page puts a top margin on every list
// item but the first, which set the first step higher than the others.
import { useLang, usePage } from '@rspress/core/runtime'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import styles from './StepProgress.module.css'

const STEP = /^\s*(\d+)[.．]\s*/
// The slim bar's height (keep in step with .dockBar in the CSS).
const DOCK = 44
// A step's heading, reached by a link or a dot, stops this far below the slim bar's top: the page
// already keeps headings clear of the bars at the top (`scroll-padding-top`), and the slim bar
// would cover the heading otherwise.
const HEADING_CLEARANCE = DOCK + 8

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
  // The column of the list, in the window: the slim bar spans the same width.
  const [left, setLeft] = useState(0)
  const [width, setWidth] = useState(0)
  const [docked, setDocked] = useState(false)

  useEffect(() => {
    let frame = 0
    function update() {
      frame = 0
      const nav = document.querySelector('.rp-nav')?.getBoundingClientRect().bottom ?? 64
      const menu = document.querySelector('.rp-doc-layout__menu')?.getBoundingClientRect()
      const bar = Math.max(nav, menu && menu.height ? menu.bottom : 0)
      setTop(bar)
      const list = full.current?.getBoundingClientRect()
      if (list) {
        setLeft(list.left)
        setWidth(list.width)
      }
      setDocked((list?.bottom ?? Infinity) < bar)
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
    const headings = steps.map((step) => document.getElementById(step.id)).filter((heading) => heading !== null)
    for (const heading of headings) heading.style.scrollMarginTop = `${HEADING_CLEARANCE}px`
    addEventListener('scroll', schedule, { passive: true })
    addEventListener('resize', schedule)
    return () => {
      for (const heading of headings) heading.style.scrollMarginTop = ''
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
      <div className={`${styles.stepDock} rp-not-doc`} style={{ top: `${top}px`, left: `${left}px`, width: `${width}px` }} aria-hidden="true">
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
