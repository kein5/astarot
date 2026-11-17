import { CHAPTERS } from '../.vitepress/theme/manual/content.mjs'

export default {
  paths: () => CHAPTERS.map((chapter) => ({ params: { chapter: chapter.slug } })),
}
