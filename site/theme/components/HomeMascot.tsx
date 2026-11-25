import { useLang, withBase } from '@rspress/core/runtime'
import { useEffect, useRef, useState } from 'react'
import styles from './HomeMascot.module.css'

const WORDS = {
  en: { caption: 'Mascot character: Devil Penguin', jump: 'Make the Devil Penguin jump' },
  ja: { caption: 'マスコットキャラクター 悪魔ペンギン', jump: '悪魔ペンギンをジャンプさせる' },
}

interface Penguin {
  destroy(): void
  jump(): void
  play(): void
  pause(): void
}

interface PenguinModel {
  mount(container: HTMLElement, options: { interactive: boolean; autoplay: boolean }): Penguin
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
  const stage = useRef<HTMLElement>(null)
  const artwork = useRef<HTMLSpanElement>(null)
  const jump = useRef<(() => void) | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setEnabled(!motion.matches)
    sync()
    motion.addEventListener('change', sync)
    return () => motion.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const target = artwork.current
    const section = stage.current
    if (!enabled || !target || !section) return
    let active = true
    let observer: IntersectionObserver | undefined
    let penguin: Penguin | undefined
    let queued = 0

    const onLand = () => {
      if (--queued > 0) penguin?.jump()
      else penguin?.pause()
    }

    const start = () => {
      observer?.disconnect()
      void loadModel()
        .then((model) => {
          if (!active) return
          const mounted = model.mount(target, { interactive: false, autoplay: false })
          penguin = mounted
          target.addEventListener('penguinjumpend', onLand)
          jump.current = () => {
            if (queued++ === 0) {
              mounted.jump()
              mounted.play()
            }
          }
          setReady(true)
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
      target.removeEventListener('penguinjumpend', onLand)
      jump.current = null
      penguin?.destroy()
      setReady(false)
    }
  }, [enabled])

  return (
    <figure ref={stage} className={styles.stage}>
      <button
        type="button"
        className={styles.picture}
        disabled={!ready}
        aria-label={words.jump}
        onClick={() => jump.current?.()}
      >
        <img
          className={ready ? styles.replaced : undefined}
          src={withBase('/mascot/penguin-front-normal.svg')}
          alt=""
          width={560}
          height={800}
        />
        <span ref={artwork} className={styles.animation} aria-hidden="true" />
      </button>
      <figcaption className={styles.caption}>{words.caption}</figcaption>
    </figure>
  )
}
