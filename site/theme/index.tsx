// The guide's theme: Rspress's default theme with the guide's own parts in its layout slots.
// Parts that pages use in Markdown (Term, CopyText, OsTabs, StepProgress, Needs, FeatureRows,
// PageToc, ManualRedirect) are registered in rspress.config.ts (`markdown.globalComponents`).
import { Head, useLang, usePage } from '@rspress/core/runtime'
import { Layout as BaseLayout, HomeLayout as BaseHomeLayout, type HomeLayoutProps } from '@rspress/core/theme-original'
import { useEffect } from 'react'
import { HomeActions, HomeShot, HomeShowcase } from './components/Home'
import { RouteStrip } from './components/RouteStrip'
import { TermTooltip } from './components/TermTooltip'
import { LOCALE_KEY } from './lib/locale'
import './tokens.css'
import './custom.css'

export * from '@rspress/core/theme-original'

// A screenshot in a page is shown at about half its size. Click it, or press Enter on it, to see
// it at full size; a click or Esc closes the larger view. rspress.config.ts marks the pictures with
// data-zoom.
function zoom(image: HTMLImageElement) {
  const dialog = document.createElement('dialog')
  dialog.className = 'shot-zoom'
  dialog.setAttribute('aria-label', image.alt)
  const large = document.createElement('img')
  large.src = image.currentSrc || image.src
  large.alt = image.alt
  dialog.append(large)
  dialog.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => {
    dialog.remove()
    image.focus()
  })
  document.body.append(dialog)
  dialog.showModal()
}

function DocumentListeners() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null
      const image = target?.closest?.('img[data-zoom]')
      if (image) zoom(image as HTMLImageElement)
      // Remember a language picked in the nav's language menu, so / opens it next time.
      const locale = target?.closest?.('a[hreflang="ja"], a[hreflang="en"]')?.getAttribute('hreflang')
      if (locale) {
        try {
          localStorage.setItem(LOCALE_KEY, locale)
        } catch {
          // Storage can be blocked; the browser language decides then.
        }
      }
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as Element | null
      if ((event.key === 'Enter' || event.key === ' ') && target?.matches?.('img[data-zoom]')) {
        event.preventDefault()
        zoom(target as HTMLImageElement)
      }
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])
  return null
}

const FOOTER = {
  ja: {
    message: 'ASTAROT（旧名VRCT-VOX）はVRCTの非公式な派生版です。VRChat Inc.とは関係ありません。',
    copyright: 'MIT License · 元のVRCTの著作権表示を保持しています',
  },
  en: {
    message: 'ASTAROT (formerly VRCT-VOX) is an unofficial derivative of VRCT. It is not affiliated with VRChat Inc.',
    copyright: 'MIT License · The original VRCT copyright notice is retained',
  },
}

// The footer of the home pages, in the page's language (the default theme has one for all).
function SiteFooter() {
  const words = useLang() === 'ja' ? FOOTER.ja : FOOTER.en
  return (
    <footer className="site-footer">
      <p>{words.message}</p>
      <p>{words.copyright}</p>
    </footer>
  )
}

// A guide page's title reads "<page> | ASTAROT", as before the move to Rspress (Rspress joins
// them with " - ").
function PageTitle() {
  const { page } = usePage()
  const doc = page.pageType === 'doc' || page.pageType === 'doc-wide'
  if (!doc || !page.title) return null
  return (
    <Head>
      <title>{`${page.title} | ASTAROT`}</title>
    </Head>
  )
}

// The hero's buttons, the download button first (front matter `heroActions`). Rspress 2.1.3's
// Layout does not pass afterHeroActions on to the home layout, so the home layout takes it here.
function HomeLayout(props: HomeLayoutProps) {
  return <BaseHomeLayout {...props} afterHeroActions={<HomeActions />} />
}

export function Layout() {
  return (
    <BaseLayout
      HomeLayout={HomeLayout}
      afterHero={<HomeShot />}
      // The features, each beside a short loop of what it does (front matter `showcase`).
      beforeFeatures={<HomeShowcase />}
      afterFeatures={<SiteFooter />}
      // Feature pages open with their part of the voice and text route (front matter `route`).
      beforeDocContent={<RouteStrip />}
      bottom={
        <>
          {/* The one bubble that every <Term> in the page shares. */}
          <TermTooltip />
          <DocumentListeners />
          <PageTitle />
        </>
      }
    />
  )
}
