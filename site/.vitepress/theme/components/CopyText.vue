<script setup lang="ts">
// A value the reader may paste somewhere (a folder, an address), with a copy button:
// <CopyText>~/.config/vrct-vox</CopyText>. The copy icon turns into a check for a moment.
import { computed, onBeforeUnmount, ref } from 'vue'
import { useData } from 'vitepress'

const { lang } = useData()
const code = ref<HTMLElement | null>(null)
const state = ref<'idle' | 'copied' | 'select'>('idle')
let timer: ReturnType<typeof setTimeout> | undefined

const words = computed(() =>
  lang.value.startsWith('ja')
    ? { copy: 'コピー', copied: 'コピーしました', select: '文字を選びました。Ctrl+C でコピーしてください' }
    : { copy: 'Copy', copied: 'Copied', select: 'Selected: press Ctrl+C to copy' },
)

async function copy() {
  const text = code.value?.textContent ?? ''
  try {
    await navigator.clipboard.writeText(text)
    state.value = 'copied'
  } catch {
    // Without the clipboard API (an insecure page, a blocked permission) select it instead.
    const range = document.createRange()
    if (code.value) range.selectNodeContents(code.value)
    getSelection()?.removeAllRanges()
    getSelection()?.addRange(range)
    state.value = 'select'
  }
  clearTimeout(timer)
  timer = setTimeout(() => (state.value = 'idle'), 1800)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <span class="copy-text" :class="state">
    <code ref="code"><slot /></code>
    <button type="button" :aria-label="words.copy" :title="words.copy" @click="copy">
      <svg class="icon-copy" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8.5" y="8.5" width="11" height="11" rx="3" />
        <path d="M15.5 8.5V7a2.5 2.5 0 0 0-2.5-2.5H7A2.5 2.5 0 0 0 4.5 7v6A2.5 2.5 0 0 0 7 15.5h1.5" />
      </svg>
      <svg class="icon-done" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </button>
    <span class="status" role="status">{{ state === 'copied' ? words.copied : state === 'select' ? words.select : '' }}</span>
  </span>
</template>

<style scoped>
.copy-text {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  vertical-align: baseline;
}

code {
  overflow-wrap: anywhere;
}

button {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  transition:
    background-color var(--vox-motion-fast) var(--vox-ease),
    color var(--vox-motion-fast) var(--vox-ease);
}

button:hover {
  background: var(--vox-surface);
  color: var(--vp-c-text-1);
}

button:focus-visible {
  outline: 2px solid #a9ccff;
  outline-offset: 1px;
}

svg {
  position: absolute;
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition:
    opacity var(--vox-motion-fast) var(--vox-ease),
    transform var(--vox-motion) var(--vox-ease-settle);
}

/* Copied: the copy icon shrinks away and a check pops in. */
.icon-done {
  opacity: 0;
  transform: scale(0.4);
  stroke-width: 2.4;
  color: var(--vox-mine);
}

.copied .icon-copy {
  opacity: 0;
  transform: scale(0.4) rotate(-20deg);
}

.copied .icon-done {
  opacity: 1;
  transform: none;
}

/* The words float above the value for as long as the check shows. */
.status {
  position: absolute;
  bottom: calc(100% + 4px);
  right: 0;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--vox-surface);
  border: 1px solid var(--vp-c-border);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  color: var(--vp-c-text-1);
  pointer-events: none;
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity var(--vox-motion-fast) var(--vox-ease),
    transform var(--vox-motion) var(--vox-ease);
}

.copied .status,
.select .status {
  opacity: 1;
  transform: none;
}
</style>
