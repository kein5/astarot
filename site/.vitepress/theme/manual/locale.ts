// The manual's language. The built pages are in Japanese; once the scripts run, the page switches
// in place to ?lang=, else the language picked before (shared with the guide's menu), else the
// browser's. The choice is remembered for the next visit and for the guide's / page.
import { computed, ref, watch } from 'vue'
import { LOCALE_KEY, preferredLocale } from '../locale'
import { CHAPTERS, WORDS, type Locale } from './content.mjs'

export const locale = ref<Locale>('ja')
export const words = computed(() => WORDS[locale.value])
/** The chapter on screen (ManualChapter.vue), or null on the home page; it names the tab. */
export const currentChapter = ref<string | null>(null)

let started = false

function apply() {
  const meta = words.value.meta
  const chapter = CHAPTERS.find((entry) => entry.slug === currentChapter.value)
  document.documentElement.lang = locale.value
  document.title = chapter ? `${chapter.title[locale.value]} | ${meta.title}` : meta.title
  document.querySelector('meta[name="description"]')?.setAttribute('content', chapter ? chapter.summary[locale.value] : meta.description)
}

export function startLocale() {
  if (started || typeof window === 'undefined') return
  started = true
  const asked = new URLSearchParams(location.search).get('lang')
  locale.value = asked === 'ja' || asked === 'en' ? asked : preferredLocale()
  apply()
  // The router sets the site's lang ('en') once the page is up; put the manual's back after it.
  setTimeout(apply)
  // Moving between the manual's pages keeps the language; the tab's title follows the page. The
  // router writes its own (Japanese) title and the site's lang on the move, so this runs after it.
  watch(currentChapter, () => setTimeout(apply))
  // A choice made in another tab follows here.
  addEventListener('storage', (event) => {
    if (event.key === LOCALE_KEY && (event.newValue === 'ja' || event.newValue === 'en')) setLocale(event.newValue, false)
  })
}

export function setLocale(value: Locale, remember = true) {
  locale.value = value
  apply()
  // A ?lang= in the address would win over the choice on reload; drop it.
  const url = new URL(location.href)
  if (url.searchParams.has('lang')) {
    url.searchParams.delete('lang')
    history.replaceState(history.state, '', url)
  }
  if (!remember) return
  try {
    localStorage.setItem(LOCALE_KEY, value)
  } catch {
    // Storage can be blocked; this page still follows the choice.
  }
}
