<script setup lang="ts">
// The frame of every manual page: the bar (name, search, language, GitHub), the page, the footer.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import { REPO_URL } from '../releases.mjs'
import ManualLangMenu from './ManualLangMenu.vue'
import { locale, startLocale, words } from './locale'
import { query } from './search'
import './manual.css'

const props = defineProps<{ home?: boolean }>()
const input = ref<HTMLInputElement | null>(null)

onMounted(() => {
  startLocale()
  if (props.home) {
    const asked = new URLSearchParams(location.search).get('q')
    if (asked) query.value = asked
  }
})

// On the home page the contents narrow as the reader types; Enter takes them there. Elsewhere,
// Enter opens the home page's contents with the words.
function onSubmit() {
  const words = query.value.trim()
  if (props.home) {
    document.getElementById('contents')?.scrollIntoView({ block: 'start' })
    return
  }
  location.href = withBase(`/manual/${words ? `?q=${encodeURIComponent(words)}` : ''}#contents`)
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && query.value) {
    event.preventDefault()
    query.value = ''
  }
}

// "/" anywhere outside a text field puts the cursor in the search box.
function onSlash(event: KeyboardEvent) {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  event.preventDefault()
  input.value?.focus()
}
onMounted(() => document.addEventListener('keydown', onSlash))
onBeforeUnmount(() => document.removeEventListener('keydown', onSlash))
</script>

<template>
  <div class="astarot" :lang="locale">
    <a class="skip" href="#main">{{ words.nav.skip }}</a>
    <header class="bar">
      <div class="a-container bar-inner">
        <a class="brand" :href="withBase('/manual/')" :aria-label="words.nav.home">
          <img :src="withBase('/manual/brand/app-icon.svg')" alt="" width="32" height="32" />
          <span class="brand-name">ASTAROT</span>
          <span class="brand-sub">{{ words.nav.name }}</span>
        </a>
        <form class="search" role="search" @submit.prevent="onSubmit">
          <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input
            ref="input"
            v-model="query"
            type="search"
            enterkeyhint="search"
            autocomplete="off"
            :placeholder="words.nav.search"
            :aria-label="words.nav.searchLabel"
            :aria-controls="props.home ? 'contents-list' : undefined"
            @keydown="onKey"
          />
          <kbd class="slash" aria-hidden="true">/</kbd>
        </form>
        <div class="actions">
          <ManualLangMenu />
          <a class="github" :href="REPO_URL" :aria-label="words.nav.github" :title="words.nav.github">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 2.5a9.5 9.5 0 0 0-3 18.52c.48.09.65-.2.65-.46v-1.6c-2.64.57-3.2-1.27-3.2-1.27-.43-1.1-1.06-1.39-1.06-1.39-.86-.59.07-.58.07-.58.95.07 1.45.98 1.45.98.85 1.45 2.22 1.03 2.76.79.09-.62.33-1.03.6-1.27-2.11-.24-4.33-1.06-4.33-4.7 0-1.04.37-1.89.98-2.55-.1-.24-.42-1.21.09-2.52 0 0 .8-.26 2.61.97a9.03 9.03 0 0 1 4.75 0c1.81-1.23 2.61-.97 2.61-.97.51 1.31.19 2.28.09 2.52.61.66.98 1.51.98 2.55 0 3.65-2.22 4.46-4.34 4.7.34.29.65.87.65 1.76v2.61c0 .26.17.56.66.46A9.5 9.5 0 0 0 12 2.5Z"
              />
            </svg>
          </a>
        </div>
      </div>
    </header>

    <main id="main" tabindex="-1">
      <slot />
    </main>

    <footer class="footer">
      <div class="a-container footer-inner">
        <img :src="withBase('/manual/brand/app-icon.svg')" alt="" width="28" height="28" />
        <div class="a-paragraphs">
          <p>{{ words.footer.unofficial }}</p>
          <p>
            {{ words.footer.license }}
            <a :href="withBase(`/${locale}/`)">{{ words.footer.guide }}</a>
          </p>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.skip {
  position: absolute;
  left: 12px;
  top: -120px;
  z-index: 100;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--a-surface);
  color: var(--a-text);
}
.skip:focus {
  box-shadow: var(--a-shadow);
  top: calc(env(safe-area-inset-top, 0px) + 12px);
}

.bar {
  position: sticky;
  top: 0;
  z-index: 30;
  padding-top: env(safe-area-inset-top, 0px);
  border-bottom: 1px solid var(--a-border);
  background: color-mix(in srgb, var(--a-bg) 88%, transparent);
  backdrop-filter: saturate(1.4) blur(12px);
}

.bar-inner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 64px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--a-text);
  text-decoration: none;
}

.brand img {
  border-radius: 8px;
}

.brand-name {
  font-family: Outfit, system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.brand-sub {
  padding-left: 10px;
  border-left: 1px solid var(--a-border-strong);
  font-size: 14px;
  color: var(--a-text-2);
}

.search {
  position: relative;
  justify-self: center;
  width: 100%;
  max-width: 420px;
}

.search input {
  width: 100%;
  height: 40px;
  padding: 0 36px 0 38px;
  border: 1px solid var(--a-border);
  border-radius: 10px;
  background: var(--a-surface);
  color: var(--a-text);
  font: inherit;
  font-size: 15px;
  transition: border-color var(--a-fast) var(--a-ease);
}

.search input::placeholder {
  color: var(--a-text-3);
}

.search input:hover {
  border-color: var(--a-border-strong);
}

.search input:focus-visible {
  outline: 2px solid var(--a-focus);
  outline-offset: 1px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  width: 18px;
  height: 18px;
  translate: 0 -50%;
  fill: none;
  stroke: var(--a-text-3);
  stroke-width: 1.8;
  stroke-linecap: round;
  pointer-events: none;
}

.slash {
  position: absolute;
  right: 10px;
  top: 50%;
  translate: 0 -50%;
  min-width: 20px;
  padding: 0 5px;
  border: 1px solid var(--a-border);
  border-radius: 5px;
  font: 12px/18px ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: center;
  color: var(--a-text-3);
  pointer-events: none;
}

.search:focus-within .slash,
.search:has(input:not(:placeholder-shown)) .slash {
  display: none;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.github {
  display: inline-grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  color: var(--a-text);
  transition: background-color var(--a-fast) var(--a-ease);
}

.github:hover {
  background: var(--a-bg-soft);
}

.github svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}

main:focus {
  outline: none;
}

.footer {
  margin-top: 96px;
  padding-block: 32px calc(32px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--a-border);
  background: var(--a-bg-soft);
  font-size: 14px;
  color: var(--a-text-2);
}

.footer-inner {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.footer img {
  border-radius: 7px;
  flex-shrink: 0;
  margin-top: 2px;
}

/* Narrow windows: the search box takes a row of its own under the name and the buttons. */
@media (max-width: 760px) {
  .bar-inner {
    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: 10px;
    padding-block: 10px;
  }
  .search {
    grid-column: 1 / -1;
    grid-row: 2;
    max-width: none;
  }
  .slash {
    display: none;
  }
}

@media (max-width: 400px) {
  .brand-sub {
    display: none;
  }
}
</style>
