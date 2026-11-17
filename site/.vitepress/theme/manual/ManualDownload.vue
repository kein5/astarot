<script setup lang="ts">
// The manual's download button. The button itself downloads the file for the reader's OS from the
// latest release (Windows: the installer, Linux: the AppImage); the menu beside it lists the seven
// files ASTAROT ships, each linked to the release's own file. Readers on other systems are sent to
// the releases page. The built page links to the latest release, so the button works before the
// script runs and when the GitHub API does not answer. The rules are in ../releases.mjs, as for the
// guide's button.
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { RELEASES_URL, detectPlatform, fillSlots, formatSize, readRelease, recommend } from '../releases.mjs'
import { loadLatestRelease } from '../latestRelease'
import { words } from './locale'
import { useMenu } from './useMenu'

type Os = 'windows' | 'linux' | 'macos'
interface Download {
  name: string
  url: string
  size: number
  os: Os
  format: string
  variant: string | null
  arch: string | null
}
interface Slot {
  id: string
  os: Os
  download: Download | null
}

const OS_NAMES: Record<string, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' }

const state = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle')
const tag = ref('')
const page = ref(`${RELEASES_URL}/latest`)
const downloads = ref<Download[]>([])
const platform = ref<{ os: Os | 'other'; arch: 'x64' | 'arm64' }>({ os: 'other', arch: 'x64' })
const controller = new AbortController()

const root = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const toggle = ref<HTMLButtonElement | null>(null)
const id = useId()
const { open, hide, onToggleClick, onToggleKey, onMenuKey, onFocusOut } = useMenu(root, menu, toggle)

const primary = computed<Download | null>(() => {
  const os = platform.value.os
  if (state.value !== 'ready' || os === 'other') return null
  return recommend(downloads.value, os, platform.value.arch)
})

const slots = computed<Slot[]>(() =>
  fillSlots(downloads.value, platform.value.os === 'linux' ? platform.value.arch : 'x64'),
)
const groups = computed(() =>
  (['windows', 'linux'] as const).map((os) => ({ os, items: slots.value.filter((slot) => slot.os === os) })),
)

// Ready, but nothing fits this reader: the button opens the releases page instead.
const toReleases = computed(() => state.value === 'ready' && !primary.value)

const note = computed(() => {
  const w = words.value.download
  if (state.value === 'idle') return w.idle
  if (state.value === 'loading') return w.loading
  if (state.value === 'failed') return w.failed
  const item = primary.value
  if (item) {
    const slot = slots.value.find((entry) => entry.download === item)
    const label = slot ? w.slots[slot.id] : item.format
    return [OS_NAMES[item.os], label, formatSize(item.size)].filter(Boolean).join(' · ')
  }
  const os = platform.value.os
  return os === 'windows' || os === 'linux' ? w.missing : w.unsupported
})

onMounted(async () => {
  platform.value = detectPlatform(navigator)
  state.value = 'loading'
  try {
    const read = readRelease(await loadLatestRelease(controller))
    if (!read.downloads.length) throw new Error('no downloads')
    downloads.value = read.downloads as Download[]
    tag.value = read.tag
    page.value = read.page
    state.value = 'ready'
  } catch {
    state.value = 'failed'
  }
})
onBeforeUnmount(() => controller.abort())

// Picking a file starts the download and leaves the page here, so the menu closes.
function onMenuClick(event: MouseEvent) {
  if ((event.target as Element | null)?.closest('a')) hide(false)
}
</script>

<template>
  <div ref="root" class="download" @focusout="onFocusOut">
    <div class="split">
      <a class="main" :href="primary ? primary.url : toReleases ? RELEASES_URL : page" :aria-describedby="`${id}-note`">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" /></svg>
        <span>{{ toReleases ? words.download.releases : words.download.download }}</span>
        <span v-if="tag" class="version">{{ tag }}</span>
      </a>
      <button
        ref="toggle"
        type="button"
        class="toggle"
        aria-haspopup="menu"
        :aria-expanded="open"
        :aria-controls="`${id}-menu`"
        :aria-label="words.download.more"
        :title="words.download.more"
        @click="onToggleClick"
        @keydown="onToggleKey"
      >
        <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 9.5 5.5 5.5 5.5-5.5" /></svg>
      </button>

      <div
        v-show="open"
        :id="`${id}-menu`"
        ref="menu"
        class="menu"
        role="menu"
        :aria-label="words.download.menu"
        @keydown="onMenuKey"
        @click="onMenuClick"
      >
        <div v-for="group in groups" :key="group.os" class="group" role="group" :aria-label="OS_NAMES[group.os]">
          <div class="group-name" aria-hidden="true">{{ OS_NAMES[group.os] }}</div>
          <a
            v-for="slot in group.items"
            :key="slot.id"
            class="item"
            :class="{ absent: state === 'ready' && !slot.download }"
            role="menuitem"
            tabindex="-1"
            :href="slot.download ? slot.download.url : page"
            :title="slot.download?.name"
            :data-current="slot.download !== null && slot.download === primary"
          >
            <span class="item-name">{{ words.download.slots[slot.id] }}</span>
            <span v-if="slot.download && slot.download === primary" class="badge">{{ words.download.recommended }}</span>
            <span class="size">
              {{ slot.download ? formatSize(slot.download.size) : state === 'ready' ? words.download.absent : '' }}
            </span>
          </a>
        </div>
        <hr class="separator" />
        <a class="item link" role="menuitem" tabindex="-1" :href="RELEASES_URL">{{ words.download.all }}</a>
      </div>
    </div>
    <p :id="`${id}-note`" class="note" aria-live="polite">{{ note }}</p>
  </div>
</template>

<style scoped>
.download {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.split {
  position: relative;
  display: inline-flex;
  border-radius: 12px;
  background: var(--a-button-bg);
  color: var(--a-button-text);
  box-shadow: 0 8px 22px color-mix(in srgb, var(--a-lilac) 35%, transparent);
}

.main,
.toggle {
  display: inline-flex;
  align-items: center;
  height: 52px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 17px;
  font-weight: 700;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--a-fast) var(--a-ease);
}

.main {
  gap: 10px;
  padding: 0 20px 0 18px;
  border-radius: 12px 0 0 12px;
}

.toggle {
  justify-content: center;
  width: 48px;
  border-left: 1px solid color-mix(in srgb, var(--a-button-text) 22%, transparent);
  border-radius: 0 12px 12px 0;
}

.main:hover,
.toggle:hover,
.toggle[aria-expanded='true'] {
  background: var(--a-button-hover);
}

.main:focus-visible,
.toggle:focus-visible {
  outline: 2px solid var(--a-focus);
  outline-offset: 3px;
}

.icon,
.chevron {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.chevron {
  transition: transform var(--a-fast) var(--a-ease);
}
.toggle[aria-expanded='true'] .chevron {
  transform: rotate(180deg);
}

.version {
  padding: 1px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--a-button-text) 14%, transparent);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
}

/* What the button downloads; it holds its height so nothing moves when it fills in. */
.note {
  min-height: 22px;
  font-size: 14px;
  line-height: 22px;
  color: var(--a-text-2);
  text-wrap: pretty;
}

.menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 30;
  width: min(380px, calc(100vw - 2 * var(--a-gutter)));
  padding: 6px;
  border: 1px solid var(--a-border);
  border-radius: 14px;
  background: var(--a-surface);
  color: var(--a-text);
  box-shadow: var(--a-shadow);
}

.group + .group {
  margin-top: 4px;
}

.group-name {
  padding: 8px 10px 4px;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  color: var(--a-text-3);
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 15px;
  line-height: 20px;
  color: var(--a-text);
  text-decoration: none;
}

.item:hover,
.item:focus-visible {
  background: var(--a-bg-soft);
}

.item:focus-visible {
  outline-offset: -2px;
}

.item-name {
  flex: 1;
  min-width: 0;
}

.item.absent .item-name,
.item.absent .size {
  color: var(--a-text-3);
}

.badge {
  flex-shrink: 0;
  padding: 0 8px;
  border-radius: 6px;
  background: var(--a-accent-soft);
  font-size: 12px;
  font-weight: 700;
  line-height: 20px;
  color: var(--a-link);
}

.size {
  flex-shrink: 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--a-text-3);
}

.item.link {
  color: var(--a-link);
}

.separator {
  height: 1px;
  margin: 6px 4px;
  border: 0;
  background: var(--a-border);
}
</style>
