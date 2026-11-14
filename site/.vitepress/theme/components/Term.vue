<script setup lang="ts">
// A term with a short explanation: <Term tip="A file format for AI models">GGUF</Term>.
// The explanation shows while a mouse is over the term or the term has keyboard focus. A tap, or
// Enter, opens and closes it. Esc, or a tap elsewhere, closes it.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { TOOLTIP_ID, hideTip, newOwner, showTip, tooltip } from '../tooltip'

const props = defineProps<{ tip: string }>()
const owner = newOwner()
const element = ref<HTMLElement | null>(null)
let hover = false
// The state when the press began: a tap focuses the term (which opens it) before its click.
let pressType = ''
let openAtPress = false

const isOpen = () => tooltip.open && tooltip.owner === owner
const show = () => element.value && showTip(owner, props.tip, element.value)
const hide = () => hideTip(owner)

function onPointerDown(event: PointerEvent) {
  pressType = event.pointerType
  openAtPress = isOpen()
}

function onClick(event: MouseEvent) {
  // Enter or Space on the focused term.
  if (event.detail === 0) return isOpen() ? hide() : show()
  if (pressType === 'mouse') return show()
  return openAtPress ? hide() : show()
}

function onEnter(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  hover = true
  show()
}

function onLeave(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  hover = false
  if (document.activeElement !== element.value) hide()
}

function outside(event: PointerEvent) {
  if (isOpen() && element.value && !element.value.contains(event.target as Node)) hide()
}

// Esc closes the explanation whether it opened by mouse, focus or tap.
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && isOpen()) hide()
}

function onBlur() {
  if (!hover) hide()
}

onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('keydown', onKey)
  addEventListener('scroll', hide, { passive: true })
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('keydown', onKey)
  removeEventListener('scroll', hide)
  hide()
})
</script>

<template>
  <button
    ref="element"
    type="button"
    class="term"
    :aria-describedby="tooltip.open && tooltip.owner === owner ? TOOLTIP_ID : undefined"
    @pointerenter="onEnter"
    @pointerleave="onLeave"
    @pointerdown="onPointerDown"
    @focus="show"
    @blur="onBlur"
    @click="onClick"
  >
    <slot />
  </button>
</template>

<style scoped>
.term {
  display: inline;
  padding: 0;
  font: inherit;
  color: inherit;
  text-decoration: underline dotted;
  text-decoration-color: var(--vp-c-text-3);
  text-underline-offset: 4px;
  cursor: help;
}

.term:hover {
  text-decoration-color: var(--vp-c-brand-1);
}

.term:focus-visible {
  outline: 2px solid #a9ccff;
  outline-offset: 2px;
  border-radius: 2px;
}
</style>
