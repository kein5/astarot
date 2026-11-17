// The manual's search box narrows the contents on the home page. On a chapter page, Enter opens
// the home page with the words in ?q=.
import { ref } from 'vue'
import { CHAPTERS, type Chapter, type Locale } from './content.mjs'

export const query = ref('')

const fold = (text: string) => text.normalize('NFKC').toLowerCase()

/** Chapters whose words, in either language, hold every word of the query. */
export function matchChapters(text: string, locale: Locale): Chapter[] {
  const terms = fold(text).split(/\s+/).filter(Boolean)
  if (!terms.length) return CHAPTERS
  return CHAPTERS.filter((chapter, index) => {
    const other: Locale = locale === 'ja' ? 'en' : 'ja'
    const haystack = fold(
      [
        String(index + 1),
        chapter.title[locale],
        chapter.summary[locale],
        chapter.title[other],
        chapter.keywords,
        ...chapter.guide.map((page) => page.label[locale]),
      ].join(' '),
    )
    return terms.every((term) => haystack.includes(term))
  })
}
