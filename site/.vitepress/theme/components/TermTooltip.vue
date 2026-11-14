<script setup lang="ts">
// The bubble for every <Term>. It sits above the term (below it near the top of the window),
// slides to the next term and fades its words, with no movement under prefers-reduced-motion.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TOOLTIP_ID, tooltip } from '../tooltip'

const bubble = ref<HTMLElement | null>(null)
const size = ref({ width: 0, height: 0 })
const MARGIN = 8
// Opening from hidden places the bubble at once; only a move between terms slides.
const jumping = ref(false)

watch(
  () => tooltip.open,
  (open, was) => {
    if (!open || was) return
    jumping.value = true
    requestAnimationFrame(() => requestAnimationFrame(() => (jumping.value = false)))
  },
)

// The size follows the bubble itself: its words change only after the old ones have faded out.
let observer: ResizeObserver | undefined
const measure = () => {
  if (bubble.value) size.value = { width: bubble.value.offsetWidth, height: bubble.value.offsetHeight }
}
onMounted(() => {
  measure()
  observer = new ResizeObserver(measure)
  if (bubble.value) observer.observe(bubble.value)
})
onBeforeUnmount(() => observer?.disconnect())

const place = computed(() => {
  const { left, top, width, height } = tooltip.rect
  const viewport = typeof window === 'undefined' ? 1024 : document.documentElement.clientWidth
  const x = Math.min(Math.max(MARGIN, left + width / 2 - size.value.width / 2), viewport - size.value.width - MARGIN)
  const below = top - size.value.height - MARGIN < 72
  const y = below ? top + height + MARGIN : top - size.value.height - MARGIN
  return { x, y, below, arrow: left + width / 2 - x }
})
</script>

<template>
  <div
    :id="TOOLTIP_ID"
    ref="bubble"
    role="tooltip"
    class="term-tooltip"
    :class="{ open: tooltip.open, below: place.below, jump: jumping }"
    :style="{ transform: `translate(${place.x}px, ${place.y}px)`, '--arrow': `${place.arrow}px` }"
  >
    <!-- A new term's words fade in where the last ones were. -->
    <span :key="tooltip.owner" class="words">{{ tooltip.text }}</span>
  </div>
</template>

<style scoped>
.term-tooltip {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 100;
  max-width: min(320px, calc(100vw - 16px));
  padding: 8px 12px;
  border: 1px solid var(--vp-c-border);
  border-radius: 10px;
  background: var(--vox-surface);
  color: var(--vp-c-text-1);
  font-size: 14px;
  line-height: 1.6;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition:
    transform var(--vox-motion) var(--vox-ease-settle),
    opacity var(--vox-motion-fast) var(--vox-ease),
    visibility 0s linear var(--vox-motion-fast);
}

.term-tooltip.open {
  opacity: 1;
  visibility: visible;
  transition:
    transform var(--vox-motion) var(--vox-ease-settle),
    opacity var(--vox-motion-fast) var(--vox-ease),
    visibility 0s;
}

.term-tooltip.open.jump {
  transition:
    opacity var(--vox-motion-fast) var(--vox-ease),
    visibility 0s;
}

/* A small arrow points at the term. */
.term-tooltip::after {
  content: '';
  position: absolute;
  left: clamp(12px, var(--arrow), calc(100% - 12px));
  bottom: -5px;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  background: inherit;
  border-right: 1px solid var(--vp-c-border);
  border-bottom: 1px solid var(--vp-c-border);
  transform: rotate(45deg);
}

.term-tooltip.below::after {
  top: -5px;
  bottom: auto;
  transform: rotate(225deg);
}

.words {
  display: block;
  animation: tip-words var(--vox-motion) var(--vox-ease);
}

@keyframes tip-words {
  from {
    opacity: 0;
  }
}
</style>
