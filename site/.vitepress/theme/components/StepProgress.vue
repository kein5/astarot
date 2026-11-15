<script setup lang="ts">
// Where the reader is in a page of numbered steps (`## 1. …`, `## 2. …`). Put <StepProgress />
// before the first step. It shows the steps with their names there; once that has scrolled away, a
// slim bar under the navigation keeps the dots and the name of the step being read. Each step jumps
// to its heading. The steps come from the page's h2 headings in its data (config.mts
// `markdown.headers`), so the list is in the built page. The slim bar takes no room in the page, so
// nothing moves when it appears.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData, useRoute } from 'vitepress'

const { lang, page } = useData()
const route = useRoute()
const current = ref(-1)
const top = ref(64)
const docked = ref(false)
const full = ref<HTMLElement | null>(null)
const label = computed(() => (lang.value.startsWith('ja') ? '手順' : 'Steps'))
let frame = 0

const STEP = /^\s*(\d+)[.．]\s*/
// The slim bar's height (keep in step with .dock-bar below).
const DOCK = 44

const steps = computed(() =>
  (page.value.headers ?? [])
    .filter((heading) => STEP.test(heading.title))
    // The number is shown in the dot.
    .map((heading) => ({ id: heading.slug, label: heading.title.replace(STEP, '').trim() })),
)

function update() {
  frame = 0
  const nav = document.querySelector('.VPNav')?.getBoundingClientRect().bottom ?? 64
  const local = document.querySelector('.VPLocalNav')?.getBoundingClientRect()
  top.value = Math.max(nav, local && local.height ? local.bottom : 0)
  docked.value = (full.value?.getBoundingClientRect().bottom ?? Infinity) < top.value
  // The step being read: the last heading that has passed under the bars.
  // At the end of the page the last headings cannot reach that line; the lowest one in sight counts.
  const end = scrollY + innerHeight >= document.documentElement.scrollHeight - 2
  const line = end ? innerHeight : top.value + DOCK + 48
  let index = -1
  steps.value.forEach((step, i) => {
    const heading = document.getElementById(step.id)
    if (heading && heading.getBoundingClientRect().top <= line) index = i
  })
  current.value = index
}

const schedule = () => {
  if (!frame) frame = requestAnimationFrame(update)
}

// The slim bar's dots are for a pointer; the list above and the page outline serve the keyboard.
function jump(id: string) {
  document.getElementById(id)?.querySelector<HTMLAnchorElement>('a.header-anchor')?.click()
}

onMounted(() => {
  nextTick(update)
  addEventListener('scroll', schedule, { passive: true })
  addEventListener('resize', schedule)
})
onBeforeUnmount(() => {
  removeEventListener('scroll', schedule)
  removeEventListener('resize', schedule)
  if (frame) cancelAnimationFrame(frame)
})
watch(() => route.path, () => nextTick(update))

const progress = computed(() =>
  steps.value.length > 1 ? Math.max(0, current.value) / (steps.value.length - 1) : 0,
)
</script>

<template>
  <template v-if="steps.length">
    <nav ref="full" class="step-progress" :aria-label="label">
      <ol :style="{ '--progress': progress, '--count': steps.length }">
        <li
          v-for="(step, index) in steps"
          :key="step.id"
          :class="{ done: index < current, current: index === current }"
        >
          <a :href="`#${step.id}`" :aria-current="index === current ? 'step' : undefined">
            <span class="dot" aria-hidden="true">
              <svg v-if="index < current" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              <template v-else>{{ index + 1 }}</template>
            </span>
            <span class="name">{{ step.label }}</span>
          </a>
        </li>
      </ol>
    </nav>
    <div class="step-dock" :style="{ top: `${top}px` }" aria-hidden="true">
      <div class="dock-bar" :class="{ shown: docked }">
        <ol>
          <li
            v-for="(step, index) in steps"
            :key="step.id"
            :class="{ done: index < current, current: index === current }"
            :title="`${index + 1}. ${step.label}`"
            @click="jump(step.id)"
          >
            <span class="dot">
              <svg v-if="index < current" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              <template v-else>{{ index + 1 }}</template>
            </span>
          </li>
        </ol>
        <p class="now">
          <template v-if="current >= 0">{{ current + 1 }}. {{ steps[current].label }}</template>
        </p>
      </div>
    </div>
  </template>
</template>

<style scoped>
/* ---------- The list with names ---------- */

.step-progress {
  margin: 24px 0 8px;
  padding: 4px 0 16px;
  border-bottom: 1px solid var(--vox-hairline);
}

.step-progress ol {
  position: relative;
  display: grid;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The track runs between the first and the last dot; the filled part grows to the current one. */
.step-progress ol::before,
.step-progress ol::after {
  content: '';
  position: absolute;
  top: 13px;
  left: calc(50% / var(--count, 5));
  height: 2px;
  border-radius: 1px;
}

.step-progress ol::before {
  right: calc(50% / var(--count, 5));
  background: var(--vp-c-border);
}

.step-progress ol::after {
  width: calc((100% - 100% / var(--count, 5)) * var(--progress));
  background: var(--vox-mine);
  transition: width var(--vox-motion) var(--vox-ease);
}

/* .vp-doc gives list items a top margin; the steps sit on one line. */
.step-progress li {
  position: relative;
  z-index: 1;
  margin: 0;
  min-width: 0;
}

.step-progress a {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  border-radius: 8px;
  color: var(--vp-c-text-3);
  font-weight: 400;
  text-decoration: none;
}

.step-progress a:focus-visible {
  outline: 2px solid #a9ccff;
  outline-offset: 2px;
}

.dot {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--vox-surface);
  border: 1px solid var(--vp-c-border);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-2);
  transition:
    background-color var(--vox-motion) var(--vox-ease),
    border-color var(--vox-motion) var(--vox-ease),
    color var(--vox-motion) var(--vox-ease);
}

.dot svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.name {
  max-width: 100%;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
  text-wrap: balance;
  word-break: auto-phrase;
  transition: color var(--vox-motion) var(--vox-ease);
}

.done .dot {
  background: var(--vox-mine);
  border-color: var(--vox-mine);
  color: #0d1625;
}

/* Every dot keeps one size; the current one stands out by its fill. */
.current .dot {
  background: var(--vp-c-text-1);
  border-color: var(--vp-c-text-1);
  color: #0d1625;
}

.step-progress .done a,
.step-progress .current a {
  color: var(--vp-c-text-1);
}

.step-progress a:hover .dot {
  border-color: var(--vox-mine);
}

/* Phones: the dots only; the slim bar names the step being read. */
@media (max-width: 639px) {
  .step-progress .name {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

/* ---------- The slim bar ---------- */

/* No height of its own, so the page does not move when the bar shows. */
.step-dock {
  position: sticky;
  z-index: 10;
  height: 0;
}

.dock-bar {
  position: absolute;
  top: 0;
  left: -8px;
  right: -8px;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 44px;
  padding: 0 8px;
  background: var(--vp-c-bg);
  border-bottom: 1px solid var(--vox-hairline);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-6px);
  transition:
    opacity var(--vox-motion-fast) var(--vox-ease),
    transform var(--vox-motion) var(--vox-ease),
    visibility 0s linear var(--vox-motion-fast);
}

.dock-bar.shown {
  opacity: 1;
  visibility: visible;
  transform: none;
  transition:
    opacity var(--vox-motion-fast) var(--vox-ease),
    transform var(--vox-motion) var(--vox-ease),
    visibility 0s;
}

.dock-bar ol {
  display: flex;
  align-items: center;
  flex: none;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dock-bar li {
  display: flex;
  align-items: center;
  margin: 0;
  cursor: pointer;
}

/* The track between two dots, filled up to the current one. */
.dock-bar li + li::before {
  content: '';
  width: 12px;
  height: 2px;
  background: var(--vp-c-border);
  transition: background-color var(--vox-motion) var(--vox-ease);
}

.dock-bar li.done + li::before {
  background: var(--vox-mine);
}

.dock-bar .dot {
  width: 22px;
  height: 22px;
  font-size: 11px;
}

.dock-bar .dot svg {
  width: 12px;
  height: 12px;
}

.dock-bar li:hover .dot {
  border-color: var(--vox-mine);
}

.now {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--vp-c-text-1);
}
</style>
