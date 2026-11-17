<script setup lang="ts">
// A boxed note in the manual, led by the guide's face for its kind (content.mjs CALLOUTS). The home
// page's legend shows each kind; chapters use it as <ManualCallout kind="tip">…</ManualCallout>.
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { CALLOUTS } from './content.mjs'
import { words } from './locale'

// The kinds of content.mjs CALLOUTS, spelled out: props types must be resolvable from this file.
const props = defineProps<{ kind: 'note' | 'tip' | 'important' | 'caution' | 'warning' | 'trouble'; title?: string }>()
const face = computed(() => CALLOUTS.find((entry) => entry.kind === props.kind)?.face ?? 'normal')
const name = computed(() => props.title ?? words.value.guide.callouts[props.kind].name)
</script>

<template>
  <aside class="callout" :class="kind" :aria-label="name">
    <img class="face" :src="withBase(`/manual/mascot/face-${face}.webp`)" alt="" width="48" height="48" loading="lazy" />
    <div class="body">
      <p class="name">{{ name }}</p>
      <div class="text"><slot /></div>
    </div>
  </aside>
</template>

<style scoped>
.callout {
  --tone: var(--a-note);
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--tone) 30%, var(--a-border));
  border-left: 4px solid var(--tone);
  border-radius: 12px;
  background: color-mix(in srgb, var(--tone) 7%, var(--a-surface));
}

.note {
  --tone: var(--a-note);
}
.tip {
  --tone: var(--a-tip);
}
.important {
  --tone: var(--a-important);
}
.caution {
  --tone: var(--a-caution);
}
.warning {
  --tone: var(--a-warning);
}
.trouble {
  --tone: var(--a-trouble);
}

.face {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--a-backdrop);
}

.body {
  min-width: 0;
}

.name {
  font-weight: 700;
  color: var(--tone);
  line-height: 1.5;
}

.text {
  margin-top: 2px;
  font-size: 15px;
  line-height: 1.7;
  color: var(--a-text-2);
}
</style>
