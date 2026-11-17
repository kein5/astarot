<script setup lang="ts">
// The language menu at the right of the manual's bar. Picking a language switches every word on
// the page in place (locale.ts).
import { ref, useId } from 'vue'
import type { Locale } from './content.mjs'
import { locale, setLocale, words } from './locale'
import { useMenu } from './useMenu'

const LANGUAGES: { value: Locale; label: string }[] = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
]

const root = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const toggle = ref<HTMLButtonElement | null>(null)
const id = useId()
const { open, hide, onToggleClick, onToggleKey, onMenuKey, onFocusOut } = useMenu(root, menu, toggle)

function pick(value: Locale) {
  setLocale(value)
  hide()
}
</script>

<template>
  <div ref="root" class="lang" @focusout="onFocusOut">
    <button
      ref="toggle"
      type="button"
      class="toggle"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="`${id}-menu`"
      :aria-label="`${words.nav.language}: ${LANGUAGES.find((item) => item.value === locale)?.label}`"
      @click="onToggleClick"
      @keydown="onToggleKey"
    >
      <svg class="globe" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5Z" />
      </svg>
      <span class="current" aria-hidden="true">{{ LANGUAGES.find((item) => item.value === locale)?.label }}</span>
      <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
    </button>
    <div
      v-show="open"
      :id="`${id}-menu`"
      ref="menu"
      class="menu"
      role="menu"
      :aria-label="words.nav.language"
      @keydown="onMenuKey"
    >
      <button
        v-for="item in LANGUAGES"
        :key="item.value"
        type="button"
        class="item"
        role="menuitemradio"
        tabindex="-1"
        :lang="item.value"
        :aria-checked="item.value === locale"
        @click="pick(item.value)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.lang {
  position: relative;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 10px;
  border: 1px solid var(--a-border);
  border-radius: 10px;
  background: var(--a-surface);
  color: var(--a-text);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: border-color var(--a-fast) var(--a-ease), background-color var(--a-fast) var(--a-ease);
}

.toggle:hover,
.toggle[aria-expanded='true'] {
  border-color: var(--a-border-strong);
  background: var(--a-bg-soft);
}

svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.chevron {
  width: 16px;
  height: 16px;
  transition: transform var(--a-fast) var(--a-ease);
}

.toggle[aria-expanded='true'] .chevron {
  transform: rotate(180deg);
}

.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  min-width: 160px;
  padding: 6px;
  border: 1px solid var(--a-border);
  border-radius: 12px;
  background: var(--a-surface);
  box-shadow: var(--a-shadow);
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--a-text);
  font: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}

/* The check mark of the language in use. */
.item::before {
  content: '';
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.item[aria-checked='true']::before {
  background: var(--a-link);
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m5 12.5 4.5 4.5L19 7.5' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
    center / contain no-repeat;
}

.item:hover,
.item:focus-visible {
  background: var(--a-bg-soft);
}

.item:focus-visible {
  outline-offset: -2px;
}

@media (max-width: 520px) {
  .current {
    display: none;
  }
}
</style>
