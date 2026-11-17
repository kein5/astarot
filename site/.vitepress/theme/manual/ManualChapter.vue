<script setup lang="ts">
// One chapter of the manual (site/manual/[chapter].md). Until a chapter's own text is written, the
// page says so and links the guide pages that cover the same ground. Text written later goes in
// the default slot and takes the place of that notice.
import { computed, onBeforeUnmount, useSlots, watchEffect } from 'vue'
import { withBase } from 'vitepress'
import ManualShell from './ManualShell.vue'
import { CHAPTERS } from './content.mjs'
import { currentChapter, locale, words } from './locale'

const props = defineProps<{ slug: string }>()
const slots = useSlots()
watchEffect(() => (currentChapter.value = props.slug))
onBeforeUnmount(() => (currentChapter.value = null))

const index = computed(() => CHAPTERS.findIndex((chapter) => chapter.slug === props.slug))
const chapter = computed(() => CHAPTERS[index.value])
const prev = computed(() => CHAPTERS[index.value - 1])
const next = computed(() => CHAPTERS[index.value + 1])
const chapterLink = (slug: string) => withBase(`/manual/${slug}`)
const guideLink = (path: string) => withBase(`/${locale.value}${path}`)
</script>

<template>
  <ManualShell>
    <article v-if="chapter" class="a-container chapter">
      <nav class="crumbs" :aria-label="words.chapter.back">
        <a :href="withBase('/manual/#contents')"><span aria-hidden="true">←</span> {{ words.chapter.back }}</a>
      </nav>

      <header class="head">
        <p class="number">{{ words.contents.chapter(index + 1) }}</p>
        <h1 class="a-heading">{{ chapter.title[locale] }}</h1>
        <p class="summary">{{ chapter.summary[locale] }}</p>
      </header>

      <div v-if="slots.default" class="body"><slot /></div>
      <template v-else>
        <div class="pending">
          <img :src="withBase('/manual/mascot/face-sleepy.webp')" alt="" width="96" height="96" />
          <div class="a-paragraphs">
            <p v-for="line in words.chapter[chapter.status]" :key="line">{{ line }}</p>
          </div>
        </div>
      </template>

      <section v-if="chapter.guide.length" class="related" aria-labelledby="related-title">
        <h2 id="related-title" class="a-heading">{{ words.chapter.related }}</h2>
        <ul>
          <li v-for="page in chapter.guide" :key="page.path">
            <a class="related-item" :href="guideLink(page.path)">
              <span>{{ page.label[locale] }}</span>
              <span aria-hidden="true">→</span>
            </a>
          </li>
        </ul>
      </section>

      <nav class="pager" :aria-label="`${words.chapter.prev} / ${words.chapter.next}`">
        <a v-if="prev" class="pager-item prev" :href="chapterLink(prev.slug)">
          <span class="pager-label">{{ words.chapter.prev }}</span>
          <span class="pager-title">{{ prev.title[locale] }}</span>
        </a>
        <span v-else />
        <a v-if="next" class="pager-item next" :href="chapterLink(next.slug)">
          <span class="pager-label">{{ words.chapter.next }}</span>
          <span class="pager-title">{{ next.title[locale] }}</span>
        </a>
      </nav>
    </article>
  </ManualShell>
</template>

<style scoped>
.chapter {
  max-width: calc(780px + 2 * var(--a-gutter));
  padding-top: clamp(28px, 5vw, 56px);
}

.crumbs a {
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.crumbs a:hover {
  text-decoration: underline;
}

.head {
  margin-top: 28px;
}

.number {
  font-family: Outfit, system-ui, sans-serif;
  font-size: 15px;
  font-weight: 700;
  color: var(--a-link);
}

.head h1 {
  margin-top: 4px;
  font-size: clamp(30px, 5vw, 42px);
}

.summary {
  margin-top: 12px;
  font-size: 18px;
  color: var(--a-text-2);
}

.pending {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 36px;
  padding: 20px 22px;
  border: 1px dashed var(--a-border-strong);
  border-radius: var(--a-radius);
  background: var(--a-bg-soft);
  color: var(--a-text-2);
}

.pending img {
  flex-shrink: 0;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--a-backdrop);
}

.body {
  margin-top: 36px;
}

.related {
  margin-top: 40px;
}

.related h2 {
  font-size: 20px;
  margin-bottom: 14px;
}

.related ul {
  display: grid;
  gap: 10px;
}

.related-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border: 1px solid var(--a-border);
  border-radius: var(--a-radius);
  background: var(--a-surface);
  font-weight: 600;
  text-decoration: none;
  transition: border-color var(--a-fast) var(--a-ease);
}

.related-item:hover {
  border-color: var(--a-lilac);
}

.pager {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 56px;
  padding-top: 24px;
  border-top: 1px solid var(--a-border);
}

.pager-item {
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  border: 1px solid var(--a-border);
  border-radius: var(--a-radius);
  text-decoration: none;
  transition: border-color var(--a-fast) var(--a-ease);
}

.pager-item:hover {
  border-color: var(--a-lilac);
}

.pager-item.next {
  text-align: right;
}

.pager-label {
  font-size: 13px;
  color: var(--a-text-3);
}

.pager-title {
  font-weight: 700;
}

@media (max-width: 520px) {
  .pager {
    grid-template-columns: minmax(0, 1fr);
  }
  .pager > span:empty {
    display: none;
  }
  .pending {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
