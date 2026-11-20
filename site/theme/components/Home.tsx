// The home page's own parts, placed in the default home layout's slots (../index.tsx):
// - HomeActions: the hero's buttons from the front matter `heroActions` (not `hero.actions`, which
//   the default hero draws by itself). An entry with `download: true` is the download button; its
//   `link` is the install page, which the button's menu points to.
// - HomeShot: one picture of the app under the hero (front matter `shot`).
// - HomeShowcase: each feature beside a short loop of what it does (front matter `showcase`).
//   site/motion renders the loops into public/motion/<lang>/. A loop plays only while it is on
//   screen; readers who prefer less motion see the finished scene as a still.
import { useFrontmatter, useLang, withBase } from '@rspress/core/runtime'
import { useEffect, useRef } from 'react'
import { DownloadButton } from './DownloadButton'
import styles from './Home.module.css'

interface Action {
  theme?: 'brand' | 'alt'
  text?: string
  link: string
  download?: boolean
}

export function HomeActions() {
  const { frontmatter } = useFrontmatter()
  const actions = (frontmatter.heroActions as Action[] | undefined) ?? []
  if (!actions.length) return null
  return (
    <div className={styles.actions}>
      {actions.map((action) =>
        action.download ? (
          <DownloadButton key={action.link} install={action.link} />
        ) : (
          <div key={action.link} className={styles.action}>
            <a className={[styles.button, action.theme === 'alt' ? styles.alt : styles.brand].join(' ')} href={withBase(action.link)}>
              {action.text}
            </a>
          </div>
        ),
      )}
    </div>
  )
}

export function HomeShot() {
  const { frontmatter } = useFrontmatter()
  const shot = frontmatter.shot as { src: string; alt: string } | undefined
  if (!shot) return null
  return (
    <div className={styles.shot}>
      <img src={withBase(shot.src)} alt={shot.alt} width={1200} height={850} />
    </div>
  )
}

interface Item {
  id: string
  title: string
  details: string
  link: string
  linkText: string
}

export function HomeShowcase() {
  const { frontmatter } = useFrontmatter()
  const folder = useLang() === 'ja' ? 'ja' : 'en'
  const items = (frontmatter.showcase as Item[] | undefined) ?? []
  const note = frontmatter.showcaseNote as { text: string; link: string; linkText: string } | undefined
  const section = useRef<HTMLElement | null>(null)
  const media = (id: string, ext: string) => withBase(`/motion/${folder}/${id}.${ext}`)

  useEffect(() => {
    const videos = Array.from(section.current?.querySelectorAll('video') ?? [])
    const visible = new Set<HTMLVideoElement>()
    const reduce = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      for (const video of videos) {
        if (!reduce.matches && visible.has(video)) video.play().catch(() => {})
        else video.pause()
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target as HTMLVideoElement
          if (entry.isIntersecting) visible.add(video)
          else visible.delete(video)
        }
        sync()
      },
      { threshold: 0.35 },
    )
    reduce.addEventListener('change', sync)
    for (const video of videos) observer.observe(video)
    return () => {
      observer.disconnect()
      reduce.removeEventListener('change', sync)
    }
  }, [folder, items.length])

  if (!items.length) return null
  return (
    <section ref={section} className={styles.showcase}>
      {items.map((item, index) => (
        <article key={item.id} className={[styles.row, index % 2 === 1 && styles.flip].filter(Boolean).join(' ')}>
          <div className={styles.media}>
            <video
              src={media(item.id, 'mp4')}
              poster={media(item.id, 'webp')}
              width={1280}
              height={500}
              muted
              loop
              playsInline
              preload="none"
              disablePictureInPicture
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
          <div className={styles.text}>
            <h2>{item.title}</h2>
            <p>{item.details}</p>
            <a className={styles.more} href={withBase(item.link)}>
              {item.linkText}
            </a>
          </div>
        </article>
      ))}
      {note && (
        <p className={styles.note}>
          {note.text} <a href={withBase(note.link)}>{note.linkText}</a>
        </p>
      )}
    </section>
  )
}
