import { h } from 'vue'
// Without VitePress's bundled Inter: the guide uses the reader's own fonts (custom.css).
import DefaultTheme from 'vitepress/theme-without-fonts'
import type { Theme } from 'vitepress'
import HomeActions from './HomeActions.vue'
import HomeShot from './HomeShot.vue'
import HomeShowcase from './HomeShowcase.vue'
import RouteStrip from './RouteStrip.vue'
import CopyText from './components/CopyText.vue'
import OsTabs from './components/OsTabs.vue'
import StepProgress from './components/StepProgress.vue'
import Term from './components/Term.vue'
import TermTooltip from './components/TermTooltip.vue'
import { LOCALE_KEY } from './locale'
import ManualCallout from './manual/ManualCallout.vue'
import './custom.css'

// A screenshot in a page is shown at about half its size. Click it, or press Enter on it, to see it
// at full size; a click or Esc closes the larger view. config.mts marks the pictures with data-zoom.
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

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      // The hero's buttons, the download button first (front matter `heroActions`).
      'home-hero-info-after': () => h(HomeActions),
      'home-hero-after': () => h(HomeShot),
      // The features, each beside a short loop of what it does (front matter `showcase`).
      'home-features-before': () => h(HomeShowcase),
      // Feature pages open with their part of the voice and text route (front matter `route`).
      'doc-before': () => h(RouteStrip),
      // The one bubble that every <Term> in the page shares.
      'layout-bottom': () => h(TermTooltip),
    }),
  enhanceApp({ app }) {
    // Parts the Markdown pages use: <StepProgress />, <OsTabs>, <CopyText>, <Term>.
    app.component('StepProgress', StepProgress)
    app.component('OsTabs', OsTabs)
    app.component('CopyText', CopyText)
    app.component('Term', Term)
    // The ASTAROT manual's boxed notes, for the chapters' text.
    app.component('ManualCallout', ManualCallout)
    if (typeof document === 'undefined') return
    document.addEventListener('click', (event) => {
      const target = event.target as Element | null
      const image = target?.closest?.('img[data-zoom]')
      if (image) zoom(image as HTMLImageElement)
      // Remember a language picked in the nav's language menu, so / opens it next time.
      const link = target?.closest?.('.VPNavBarTranslations a, .VPNavScreenTranslations a')
      const locale = link?.getAttribute('href')?.match(/\/(ja|en)\//)?.[1]
      if (locale) {
        try {
          localStorage.setItem(LOCALE_KEY, locale)
        } catch {
          // Storage can be blocked; the browser language decides then.
        }
      }
    })
    document.addEventListener('keydown', (event) => {
      const target = event.target as Element | null
      if ((event.key === 'Enter' || event.key === ' ') && target?.matches?.('img[data-zoom]')) {
        event.preventDefault()
        zoom(target as HTMLImageElement)
      }
    })
  },
} satisfies Theme
