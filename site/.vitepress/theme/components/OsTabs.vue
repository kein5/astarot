<script setup lang="ts">
// Steps that differ between Windows and Linux, as a segmented control:
//
//   <OsTabs>
//   <template v-slot:windows>
//
//   …Markdown for Windows…
//
//   </template>
//   <template v-slot:linux>
//
//   …Markdown for Linux…
//
//   </template>
//   </OsTabs>
//
// Write v-slot:, not #: Markdown only keeps a line as HTML when its attribute names start with a
// letter. Both panels are in the page (search finds either); the one for the reader's OS shows.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { chooseOs, os, startOs, type Os } from '../os'

const tabs: { id: Os; label: string }[] = [
  { id: 'windows', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
]
const base = useId()
const list = ref<HTMLElement | null>(null)
const buttons = ref<HTMLButtonElement[]>([])
const thumb = ref({ x: 0, width: 0 })

function measure() {
  const index = tabs.findIndex((tab) => tab.id === os.value)
  const button = buttons.value[index]
  if (button) thumb.value = { x: button.offsetLeft, width: button.offsetWidth }
}

function onKey(event: KeyboardEvent) {
  const index = tabs.findIndex((tab) => tab.id === os.value)
  const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index }[event.key]
  if (step === undefined) return
  event.preventDefault()
  const next = (index + step + tabs.length) % tabs.length
  chooseOs(tabs[next].id)
  nextTick(() => buttons.value[next]?.focus())
}

onMounted(() => {
  startOs()
  nextTick(measure)
  addEventListener('resize', measure)
})
onBeforeUnmount(() => removeEventListener('resize', measure))
watch(os, () => nextTick(measure))

const thumbStyle = computed(() => ({
  transform: `translateX(${thumb.value.x}px)`,
  width: `${thumb.value.width}px`,
  opacity: thumb.value.width ? 1 : 0,
}))
</script>

<template>
  <div class="os-tabs">
    <div ref="list" class="segmented" role="tablist" aria-label="OS" @keydown="onKey">
      <span class="thumb" :style="thumbStyle" aria-hidden="true" />
      <button
        v-for="tab in tabs"
        :id="`${base}-${tab.id}-tab`"
        :key="tab.id"
        ref="buttons"
        type="button"
        role="tab"
        :aria-selected="os === tab.id"
        :aria-controls="`${base}-${tab.id}`"
        :tabindex="os === tab.id ? 0 : -1"
        @click="chooseOs(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div
      v-for="tab in tabs"
      v-show="os === tab.id"
      :id="`${base}-${tab.id}`"
      :key="tab.id"
      class="panel"
      role="tabpanel"
      :aria-labelledby="`${base}-${tab.id}-tab`"
    >
      <slot :name="tab.id" />
    </div>
  </div>
</template>

<style scoped>
.os-tabs {
  margin: 16px 0;
}

.segmented {
  position: relative;
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--vox-hairline);
  border-radius: 10px;
  background: var(--vp-c-bg-alt);
}

/* The selected segment's pill slides to it and lands with one small overshoot. */
.thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  border-radius: 7px;
  background: var(--vox-surface);
  box-shadow: inset 0 0 0 1px var(--vp-c-border);
  transition:
    transform var(--vox-motion) var(--vox-ease-settle),
    width var(--vox-motion) var(--vox-ease);
}

button {
  position: relative;
  z-index: 1;
  min-width: 88px;
  padding: 6px 14px;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  color: var(--vp-c-text-2);
  transition: color var(--vox-motion-fast) var(--vox-ease);
}

button[aria-selected='true'] {
  color: var(--vp-c-text-1);
}

button:hover {
  color: var(--vp-c-text-1);
}

button:focus-visible {
  outline: 2px solid #a9ccff;
  outline-offset: 1px;
}

.panel {
  margin-top: 12px;
  animation: os-panel-in var(--vox-motion) var(--vox-ease);
}

.panel > :deep(:first-child) {
  margin-top: 0;
}

@keyframes os-panel-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
</style>
