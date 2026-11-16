<script setup lang="ts">
// The home page's download button: the file for the reader's OS from the latest release, and a
// menu with every file, all versions and the source code. The built page holds a link to the
// releases page, so the button works before the script runs and when the GitHub API does not
// answer. Which file is which comes from ../releases.mjs.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useData, withBase } from 'vitepress'
import {
  LATEST_API,
  RELEASES_URL,
  REPO_URL,
  detectPlatform,
  formatSize,
  readRelease,
  recommend,
} from '../releases.mjs'

const props = defineProps<{ install: string }>()

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
interface Release {
  tag: string
  page: string
  groups: { os: Os; items: Download[] }[]
  downloads: Download[]
  skipped: number
}

const { lang } = useData()
const ja = computed(() => lang.value.startsWith('ja'))

const WORDS = {
  ja: {
    download: 'ダウンロード',
    choose: 'ファイルを選ぶ',
    more: 'ほかの形式とバージョン',
    menu: 'ダウンロードするファイル',
    recommended: 'おすすめ',
    install: 'インストールの手順',
    all: 'すべてのバージョン',
    source: 'ソースコード',
    others: (n: number) => `ほかのファイル（${n}件）`,
    idle: 'GitHub Releasesの最新版のページを開きます',
    loading: '最新版を確かめています',
    failed: 'ファイルの一覧を読み込めませんでした。ボタンからGitHub Releasesのページを開けます',
    unsupported: (os: string) => `${os}向けの版はありません。WindowsとLinuxの版は一覧から選べます`,
    missing: (os: string) => `この版には${os}向けのファイルがありません。一覧から選べます`,
    formats: {
      installer: 'インストーラー',
      msi: 'インストーラー（MSI）',
      zip: 'ZIP（インストール不要）',
      appimage: 'AppImage',
      deb: 'deb（Ubuntu・Debian）',
      rpm: 'rpm（Fedora）',
      tar: 'tar.gz',
      dmg: 'ディスクイメージ（dmg）',
    } as Record<string, string>,
    variants: { cpu: 'CPU版', cuda: 'CUDA版（NVIDIA GPU）', vulkan: 'Vulkan', rocm: 'ROCm', directml: 'DirectML' } as Record<string, string>,
    thisOs: 'お使いのOS',
  },
  en: {
    download: 'Download',
    choose: 'Choose a file',
    more: 'Other formats and versions',
    menu: 'Files to download',
    recommended: 'Recommended',
    install: 'How to install',
    all: 'All versions',
    source: 'Source code',
    others: (n: number) => `Other files (${n})`,
    idle: 'Opens the latest release on GitHub Releases',
    loading: 'Checking the latest release',
    failed: 'Could not load the list of files. The button opens GitHub Releases',
    unsupported: (os: string) => `There is no build for ${os}. The Windows and Linux builds are in the list`,
    missing: (os: string) => `This release has no file for ${os}. Choose one from the list`,
    formats: {
      installer: 'Installer',
      msi: 'Installer (MSI)',
      zip: 'ZIP (no install)',
      appimage: 'AppImage',
      deb: 'deb (Ubuntu, Debian)',
      rpm: 'rpm (Fedora)',
      tar: 'tar.gz',
      dmg: 'Disk image (dmg)',
    } as Record<string, string>,
    variants: { cpu: 'CPU', cuda: 'CUDA (NVIDIA GPU)', vulkan: 'Vulkan', rocm: 'ROCm', directml: 'DirectML' } as Record<string, string>,
    thisOs: 'your OS',
  },
}
const words = computed(() => (ja.value ? WORDS.ja : WORDS.en))
const OS_NAMES: Record<Os, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' }

const state = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle')
const release = ref<Release | null>(null)
const platform = ref<{ os: Os | 'other'; arch: 'x64' | 'arm64' }>({ os: 'other', arch: 'x64' })
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const toggle = ref<HTMLButtonElement | null>(null)
const id = useId()

const primary = computed<Download | null>(() => {
  if (state.value !== 'ready' || !release.value || platform.value.os === 'other') return null
  return recommend(release.value.downloads, platform.value.os, platform.value.arch)
})

function variantOf(item: Download) {
  const parts = [item.variant ? words.value.variants[item.variant] ?? item.variant : '', item.arch === 'arm64' ? 'ARM64' : '']
  return parts.filter(Boolean).join(' · ')
}

const note = computed(() => {
  const w = words.value
  if (state.value === 'idle') return w.idle
  if (state.value === 'loading') return w.loading
  if (state.value === 'failed' || !release.value) return w.failed
  const item = primary.value
  if (item) return [OS_NAMES[item.os], w.formats[item.format], variantOf(item), formatSize(item.size)].filter(Boolean).join(' · ')
  const os = platform.value.os
  if (os === 'windows' || os === 'linux') return w.missing(OS_NAMES[os])
  return w.unsupported(os === 'macos' ? OS_NAMES.macos : w.thisOs)
})

// One answer per tab and quarter hour: the API allows 60 unsigned requests an hour per address.
const CACHE_KEY = 'vrct-vox-guide-latest-release'
const CACHE_MS = 15 * 60 * 1000
let controller: AbortController | undefined

async function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null')
    if (saved && Date.now() - saved.at < CACHE_MS) return saved.release
  } catch {
    // Storage can be blocked; ask the API.
  }
  controller = new AbortController()
  const timer = setTimeout(() => controller?.abort(), 10000)
  try {
    const response = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal })
    if (!response.ok) throw new Error(`GitHub API ${response.status}`)
    const data = await response.json()
    // Only what the page reads.
    const slim = {
      tag_name: data?.tag_name,
      html_url: data?.html_url,
      assets: (Array.isArray(data?.assets) ? data.assets : []).map((asset: Record<string, unknown>) => ({
        name: asset?.name,
        size: asset?.size,
        browser_download_url: asset?.browser_download_url,
      })),
    }
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release: slim }))
    } catch {
      // Not kept; the next visit asks again.
    }
    return slim
  } finally {
    clearTimeout(timer)
  }
}

onMounted(async () => {
  platform.value = detectPlatform(navigator)
  state.value = 'loading'
  try {
    const read = readRelease(await load()) as Release
    if (!read.downloads.length) throw new Error('no downloads')
    release.value = read
    state.value = 'ready'
  } catch {
    state.value = 'failed'
  }
})

// ---------- The menu ----------

const items = () => Array.from(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

function show(focus: 'first' | 'last' = 'first') {
  open.value = true
  nextTick(() => {
    const list = items()
    const recommended = list.find((item) => item.dataset.recommended === 'true')
    ;(focus === 'last' ? list[list.length - 1] : recommended ?? list[0])?.focus()
  })
}

function hide(returnFocus = true) {
  if (!open.value) return
  open.value = false
  if (returnFocus) toggle.value?.focus()
}

function onToggleKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    show('first')
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    show('last')
  }
}

function onMenuKey(event: KeyboardEvent) {
  const list = items()
  const index = list.indexOf(document.activeElement as HTMLElement)
  const move = (to: number) => {
    event.preventDefault()
    list[(to + list.length) % list.length]?.focus()
  }
  switch (event.key) {
    case 'ArrowDown':
      return move(index + 1)
    case 'ArrowUp':
      return move(index - 1)
    case 'Home':
      return move(0)
    case 'End':
      return move(list.length - 1)
    case 'Escape':
      event.preventDefault()
      return hide()
    case 'Tab':
      return hide(false)
    case ' ':
      event.preventDefault()
      return (document.activeElement as HTMLElement | null)?.click()
  }
}

// Picking a file starts the download and leaves the page here, so the menu closes.
function onMenuClick(event: MouseEvent) {
  if ((event.target as Element | null)?.closest('a')) hide(false)
}

// A press anywhere else, or focus going elsewhere, closes it.
function onPointerDown(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) hide(false)
}
function onFocusOut(event: FocusEvent) {
  if (open.value && !root.value?.contains(event.relatedTarget as Node | null)) hide(false)
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  controller?.abort()
})
</script>

<template>
  <div ref="root" class="download" :class="state" @focusout="onFocusOut">
    <div class="split">
      <a
        v-if="primary || state !== 'ready'"
        class="main"
        :href="primary ? primary.url : `${RELEASES_URL}/latest`"
        :aria-describedby="`${id}-note`"
      >
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" /></svg>
        <span>{{ words.download }}</span>
        <span v-if="release" class="version">{{ release.tag }}</span>
      </a>
      <button
        v-else
        type="button"
        class="main"
        aria-haspopup="menu"
        :aria-expanded="open"
        :aria-controls="`${id}-menu`"
        :aria-describedby="`${id}-note`"
        @click="open ? hide() : show()"
        @keydown="onToggleKey"
      >
        <span>{{ words.choose }}</span>
        <span v-if="release" class="version">{{ release.tag }}</span>
      </button>
      <button
        ref="toggle"
        type="button"
        class="toggle"
        aria-haspopup="menu"
        :aria-expanded="open"
        :aria-controls="`${id}-menu`"
        :aria-label="words.more"
        :title="words.more"
        @click="open ? hide() : show()"
        @keydown="onToggleKey"
      >
        <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 9.5 5.5 5.5 5.5-5.5" /></svg>
      </button>

      <div v-show="open" :id="`${id}-menu`" ref="menu" class="menu" role="menu" :aria-label="words.menu" @keydown="onMenuKey" @click="onMenuClick">
        <template v-if="state === 'ready' && release">
          <div v-for="group in release.groups" :key="group.os" class="group" role="group" :aria-label="OS_NAMES[group.os]">
            <div class="group-name" aria-hidden="true">{{ OS_NAMES[group.os] }}</div>
            <a
              v-for="item in group.items"
              :key="item.name"
              class="item"
              role="menuitem"
              tabindex="-1"
              :href="item.url"
              :title="item.name"
              :data-recommended="item === primary"
            >
              <span class="item-name">
                {{ words.formats[item.format] ?? item.format }}
                <span v-if="variantOf(item)" class="variant">{{ variantOf(item) }}</span>
              </span>
              <span v-if="item === primary" class="badge">{{ words.recommended }}</span>
              <span class="size">{{ formatSize(item.size) }}</span>
            </a>
          </div>
          <a v-if="release.skipped" class="item link" role="menuitem" tabindex="-1" :href="release.page">
            {{ words.others(release.skipped) }}
          </a>
        </template>
        <p v-else class="status" aria-hidden="true">{{ note }}</p>
        <div class="separator" role="separator" />
        <a class="item link" role="menuitem" tabindex="-1" :href="withBase(props.install)">{{ words.install }}</a>
        <a class="item link" role="menuitem" tabindex="-1" :href="RELEASES_URL">{{ words.all }}</a>
        <a class="item link" role="menuitem" tabindex="-1" :href="REPO_URL">{{ words.source }}</a>
      </div>
    </div>
    <p :id="`${id}-note`" class="note" aria-live="polite">{{ note }}</p>
  </div>
</template>

<style scoped>
/* The button and its menu sit in the hero's row of buttons (HomeActions.vue); the note takes a
   line of its own under the whole row, so a long one does not push the other buttons aside. */
.download {
  display: contents;
}

/* One control in two parts: the file for this OS, and the menu beside it. */
.split {
  position: relative;
  display: inline-flex;
  margin: 6px;
  border-radius: 8px;
  background: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
}

.main,
.toggle {
  display: inline-flex;
  align-items: center;
  height: 44px;
  border: 1px solid transparent;
  font-size: 15px;
  font-weight: 600;
  color: inherit;
  white-space: nowrap;
  text-decoration: none;
  transition: background-color var(--vox-motion-fast) var(--vox-ease);
}

.main {
  gap: 8px;
  padding: 0 18px 0 16px;
  border-radius: 8px 0 0 8px;
}

.toggle {
  justify-content: center;
  width: 44px;
  border-left-color: rgba(237, 243, 255, 0.22);
  border-radius: 0 8px 8px 0;
}

.main:hover,
.toggle:hover,
.toggle[aria-expanded='true'] {
  background: var(--vp-button-brand-hover-bg);
}

.main:focus-visible,
.toggle:focus-visible {
  position: relative;
  outline: 2px solid #a9ccff;
  outline-offset: 2px;
}

.icon,
.chevron {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.chevron {
  transition: transform var(--vox-motion) var(--vox-ease);
}

.toggle[aria-expanded='true'] .chevron {
  transform: rotate(180deg);
}

.version {
  padding: 1px 7px;
  border-radius: 5px;
  background: rgba(13, 22, 37, 0.28);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
}

/* What the button downloads, under it; it holds its height so nothing moves when it fills in. */
.note {
  order: 1;
  flex-basis: 100%;
  min-height: 20px;
  margin: 2px 6px 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--vp-c-text-2);
  text-wrap: pretty;
}

.menu {
  position: absolute;
  top: 52px;
  left: 0;
  text-align: left;
  z-index: 30;
  width: min(380px, calc(100vw - 48px));
  padding: 6px;
  border: 1px solid var(--vp-c-border);
  border-radius: 10px;
  background: var(--vp-c-bg-elv);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
  transform-origin: top left;
  animation: menu-in var(--vox-motion-fast) var(--vox-ease);
}

@keyframes menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
}

.group + .group {
  margin-top: 4px;
}

.group-name {
  padding: 8px 10px 4px;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  color: var(--vp-c-text-3);
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 8px 10px;
  border-radius: 7px;
  font-size: 14px;
  line-height: 20px;
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition: background-color var(--vox-motion-fast) var(--vox-ease);
}

.item:hover,
.item:focus-visible {
  background: var(--vox-hairline);
}

.item:focus-visible {
  outline: 2px solid #a9ccff;
  outline-offset: -2px;
}

.item-name {
  flex: 1;
  min-width: 0;
}

.variant {
  display: inline-block;
  margin-left: 6px;
  color: var(--vp-c-text-2);
}

.badge {
  flex-shrink: 0;
  padding: 0 7px;
  border-radius: 5px;
  background: var(--vp-c-brand-soft);
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  color: var(--vp-c-brand-1);
}

.size {
  flex-shrink: 0;
  min-width: 56px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--vp-c-text-3);
}

.item.link {
  color: var(--vp-c-brand-1);
}

.status {
  margin: 0;
  padding: 10px;
  font-size: 13px;
  line-height: 20px;
  color: var(--vp-c-text-2);
}

.separator {
  height: 1px;
  margin: 6px 4px;
  background: var(--vox-hairline);
}
</style>
