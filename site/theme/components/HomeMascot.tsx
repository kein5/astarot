import { useLang, withBase } from '@rspress/core/runtime'
import { useEffect, useRef, useState } from 'react'
import styles from './HomeMascot.module.css'

const PAUSE_KEY = 'astarot-mascot-paused'
const WORDS = {
  en: { alt: 'A devil penguin wearing headphones', pause: 'Stop mascot motion', play: 'Resume mascot motion' },
  ja: { alt: 'ヘッドホンを着けた悪魔ペンギン', pause: 'ペンギンの動きを止める', play: 'ペンギンの動きを再開' },
}

interface Penguin {
  destroy(): void
}

interface PenguinModel {
  mount(container: HTMLElement, options: { interactive: boolean; follow: boolean }): Penguin
}

let pendingModel: Promise<PenguinModel> | undefined

function loadModel(): Promise<PenguinModel> {
  if (pendingModel) return pendingModel
  pendingModel = new Promise<PenguinModel>((resolve, reject) => {
    const script = document.createElement('script')
    const fail = () => {
      script.remove()
      reject(new Error('The mascot model could not be loaded.'))
    }
    script.src = withBase('/mascot/penguin-lite.js')
    script.onload = () => {
      const model = (window as Window & { DevilPenguin?: PenguinModel }).DevilPenguin
      if (model) resolve(model)
      else fail()
    }
    script.onerror = fail
    document.head.append(script)
  }).catch((error) => {
    pendingModel = undefined
    throw error
  })
  return pendingModel
}

export function HomeMascot() {
  const lang = useLang() === 'ja' ? 'ja' : 'en'
  const words = WORDS[lang]
  const stage = useRef<HTMLDivElement>(null)
  const artwork = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [paused, setPaused] = useState(false)
  const [running, setRunning] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setEnabled(!motion.matches)
    try {
      setPaused(localStorage.getItem(PAUSE_KEY) === '1')
    } catch {
      // Keep the choice for the current page if storage is blocked.
    }
    sync()
    motion.addEventListener('change', sync)
    return () => motion.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const target = artwork.current
    const section = stage.current
    if (!enabled || paused || !target || !section) return
    let active = true
    let observer: IntersectionObserver | undefined
    let penguin: Penguin | undefined

    const start = () => {
      observer?.disconnect()
      void loadModel()
        .then((model) => {
          if (!active) return
          penguin = model.mount(target, { interactive: false, follow: true })
          setHasStarted(true)
          setRunning(true)
        })
        .catch(() => {
          // The static image is already present.
        })
    }

    const observe = () => {
      if (!window.IntersectionObserver) {
        start()
        return
      }
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) start()
      })
      observer.observe(section)
    }

    if (document.readyState === 'complete') observe()
    else window.addEventListener('load', observe, { once: true })

    return () => {
      active = false
      window.removeEventListener('load', observe)
      observer?.disconnect()
      penguin?.destroy()
      setRunning(false)
    }
  }, [enabled, paused])

  const toggle = () => {
    const next = !paused
    setHasStarted(true)
    setPaused(next)
    try {
      localStorage.setItem(PAUSE_KEY, next ? '1' : '0')
    } catch {
      // Keep the choice for the current page if storage is blocked.
    }
  }

  return (
    <div ref={stage} className={styles.stage}>
      <div className={styles.picture}>
        <img
          className={running ? styles.replaced : undefined}
          src={withBase('/mascot/penguin-front-normal.svg')}
          alt={words.alt}
          width={560}
          height={800}
        />
        <div ref={artwork} className={styles.animation} aria-hidden="true" />
      </div>
      <div className={styles.controls}>
        {enabled && (hasStarted || paused) && (
          <button type="button" className={styles.toggle} onClick={toggle}>
            {paused ? words.play : words.pause}
          </button>
        )}
      </div>
    </div>
  )
}
