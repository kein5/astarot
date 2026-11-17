// The home page's download button (components/DownloadButton.vue) reads the latest release from
// the GitHub API and sorts its assets with this file. It names nothing by its exact file name, so
// a release that renames, adds or drops a file still lists without a change here: a file is known
// by its extension and the words in its name (os, engine, cpu). A file that none of the rules
// knows is left out of the list, and the menu points to the release page for it.
//
// tools/check_site_downloads.mjs checks these rules against past and expected asset lists.

export const REPO = 'kein5/astarot'
export const REPO_URL = `https://github.com/${REPO}`
export const RELEASES_URL = `${REPO_URL}/releases`
export const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
// Only files of this repository's releases become links.
const DOWNLOAD_PREFIX = `${REPO_URL}/releases/download/`

/** @typedef {'windows' | 'linux' | 'macos'} Os */
/** @typedef {'installer' | 'msi' | 'zip' | 'appimage' | 'deb' | 'rpm' | 'tar' | 'dmg'} Format */
/**
 * @typedef {object} Download
 * @property {string} name   the file name
 * @property {string} url    where the browser downloads it
 * @property {number} size   bytes
 * @property {Os} os
 * @property {Format} format
 * @property {string | null} variant  'cuda', 'vulkan', 'cpu', or null when the name has none
 * @property {string | null} arch     'x64' or 'arm64', or null when the name has none
 */

// Checksums, signatures and the release's own records go with a download; they are not one.
const COMPANION = /(\.sha256|\.sha512|\.sig|\.asc|\.minisig|\.json|\.txt|\.blockmap)$|^SHA\d*SUMS/i

// The extension decides the format and, where only one OS uses it, the OS.
const FORMATS = [
  { test: /(^|[-_.])setup\.exe$/i, format: 'installer', os: 'windows' },
  { test: /\.msi$/i, format: 'msi', os: 'windows' },
  { test: /\.appimage$/i, format: 'appimage', os: 'linux' },
  { test: /\.deb$/i, format: 'deb', os: 'linux' },
  { test: /\.rpm$/i, format: 'rpm', os: 'linux' },
  { test: /\.dmg$/i, format: 'dmg', os: 'macos' },
  // Archives name their OS; one that does not is Windows', as VRCT-VOX.zip has always been.
  { test: /\.zip$/i, format: 'zip', os: null },
  { test: /\.(tar\.gz|tgz|tar\.xz|tar\.zst)$/i, format: 'tar', os: null },
]

// Words are split at - _ . and spaces, so "linux-x64-vulkan" and "VRCT-VOX_cuda" both read.
const words = (name) => name.toLowerCase().split(/[-_.\s]+/)

function osOf(list, fallback) {
  if (list.some((word) => ['linux', 'ubuntu', 'debian', 'fedora'].includes(word))) return 'linux'
  if (list.some((word) => ['mac', 'macos', 'darwin', 'osx'].includes(word))) return 'macos'
  if (list.some((word) => ['win', 'windows', 'win64', 'win32'].includes(word))) return 'windows'
  return fallback
}

const VARIANTS = ['cuda', 'vulkan', 'cpu', 'rocm', 'directml']
const ARCHES = { x64: 'x64', x86_64: 'x64', amd64: 'x64', arm64: 'arm64', aarch64: 'arm64' }

/**
 * One release asset as a download, or null when it is not one this page lists.
 * @param {{ name: string, browser_download_url: string, size?: number }} asset
 * @returns {Download | null}
 */
export function classify(asset) {
  const name = asset?.name
  const url = asset?.browser_download_url
  if (typeof name !== 'string' || typeof url !== 'string' || !url.startsWith(DOWNLOAD_PREFIX)) return null
  if (COMPANION.test(name)) return null
  const rule = FORMATS.find((entry) => entry.test.test(name))
  if (!rule) return null
  const list = words(name)
  // A tar archive is the Linux build only when its name says so; a bare one may be the source.
  const os = rule.os ?? osOf(list, rule.format === 'zip' ? 'windows' : null)
  if (!os) return null
  // x86_64 is split into x86 and 64 by the word split; join it back before looking.
  const joined = name.toLowerCase().replace(/x86[-_]64/g, 'x86_64')
  const arch = Object.entries(ARCHES).find(([word]) => new RegExp(`(^|[-_.])${word}([-_.]|$)`).test(joined))?.[1] ?? null
  const variant = VARIANTS.find((word) => list.includes(word)) ?? null
  return { name, url, size: Number(asset.size) || 0, os, format: rule.format, variant, arch }
}

const FORMAT_ORDER = ['installer', 'msi', 'appimage', 'deb', 'rpm', 'zip', 'tar', 'dmg']
const OS_ORDER = ['windows', 'linux', 'macos']
// The build any PC runs first; CUDA, which needs an NVIDIA GPU, after it.
const variantRank = (variant) => (variant === null ? 0 : variant === 'cuda' ? 2 : 1)

/**
 * The release's downloads, grouped by OS in a fixed order, and how many files were left out.
 * @param {{ tag_name?: string, html_url?: string, assets?: unknown[] }} release
 */
export function readRelease(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const downloads = assets.map(classify).filter(Boolean)
  // A file with no engine word beside one with "cuda" is the CPU build (VRCT-VOX.zip next to
  // VRCT-VOX_cuda.zip). Alone, it stays unnamed: then there is only one build to take.
  for (const item of downloads) {
    if (item.variant !== null) continue
    const siblings = downloads.filter((other) => other !== item && other.os === item.os && other.format === item.format)
    if (siblings.some((other) => other.variant === 'cuda')) item.variant = 'cpu'
  }
  downloads.sort(
    (a, b) =>
      OS_ORDER.indexOf(a.os) - OS_ORDER.indexOf(b.os) ||
      FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format) ||
      variantRank(a.variant) - variantRank(b.variant) ||
      a.name.localeCompare(b.name),
  )
  const tag = typeof release?.tag_name === 'string' ? release.tag_name : ''
  const page = typeof release?.html_url === 'string' && release.html_url.startsWith(RELEASES_URL) ? release.html_url : RELEASES_URL
  const groups = OS_ORDER.map((os) => ({ os, items: downloads.filter((item) => item.os === os) })).filter(
    (group) => group.items.length,
  )
  const skipped = assets.filter((asset) => asset && typeof asset.name === 'string' && !COMPANION.test(asset.name)).length - downloads.length
  return { tag, page, groups, downloads, skipped }
}

// What the button offers first on each OS. Windows: the installer, which also asks CPU or GPU.
// Linux: the AppImage, which runs on most distributions; deb and rpm wait in the menu.
const PREFERRED = {
  windows: ['installer', 'msi', 'zip'],
  linux: ['appimage', 'deb', 'rpm', 'tar'],
  macos: ['dmg', 'zip'],
}

/**
 * The download to put on the button for a reader on `os`, or null when the release has none.
 * @param {Download[]} downloads  already sorted by readRelease
 * @param {Os | null} os
 * @param {'x64' | 'arm64'} [arch]
 */
export function recommend(downloads, os, arch = 'x64') {
  if (!os || !PREFERRED[os]) return null
  const fits = downloads.filter((item) => item.os === os && (item.arch === null || item.arch === arch))
  for (const format of PREFERRED[os]) {
    // Not the CUDA build when another one is there: it needs an NVIDIA GPU.
    const found = fits.filter((item) => item.format === format && item.variant !== 'cuda')[0] ?? fits.find((item) => item.format === format)
    if (found) return found
  }
  return null
}

// The manual's download menu (manual/ManualDownload.vue) always shows these seven files, in this
// order, whether or not the release has each one. `variant` narrows a slot to one build: 'cpu'
// also takes a file with no engine word, since a lone build is the one every PC runs.
export const SLOTS = [
  { id: 'windows-installer', os: 'windows', format: 'installer' },
  { id: 'windows-zip-cpu', os: 'windows', format: 'zip', variant: 'cpu' },
  { id: 'windows-zip-cuda', os: 'windows', format: 'zip', variant: 'cuda' },
  { id: 'linux-appimage', os: 'linux', format: 'appimage' },
  { id: 'linux-deb', os: 'linux', format: 'deb' },
  { id: 'linux-rpm', os: 'linux', format: 'rpm' },
  { id: 'linux-tar', os: 'linux', format: 'tar' },
]

/**
 * The release's file for each of SLOTS, or null where it has none.
 * @param {Download[]} downloads  already sorted by readRelease
 * @param {'x64' | 'arm64'} [arch]
 * @returns {{ id: string, os: Os, format: Format, variant?: string, download: Download | null }[]}
 */
export function fillSlots(downloads, arch = 'x64') {
  const list = Array.isArray(downloads) ? downloads : []
  return SLOTS.map((slot) => {
    const fits = list.filter(
      (item) => item.os === slot.os && item.format === slot.format && (item.arch === null || item.arch === arch),
    )
    let download
    if (slot.variant === 'cuda') download = fits.find((item) => item.variant === 'cuda')
    else if (slot.variant === 'cpu') download = fits.find((item) => item.variant === 'cpu' || item.variant === null)
    // Not the CUDA build when another one is there, as on the button.
    else download = fits.find((item) => item.variant !== 'cuda') ?? fits[0]
    return { ...slot, download: download ?? null }
  })
}

/**
 * The reader's OS and CPU from the browser. Phones and tablets have no build; they are 'other'.
 * @param {{ userAgent?: string, platform?: string, userAgentData?: { platform?: string, mobile?: boolean } }} nav
 * @returns {{ os: Os | 'other', arch: 'x64' | 'arm64' }}
 */
export function detectPlatform(nav) {
  const agent = nav?.userAgent ?? ''
  const hint = nav?.userAgentData?.platform ?? ''
  const arch = /aarch64|arm64/i.test(agent) ? 'arm64' : 'x64'
  if (nav?.userAgentData?.mobile || /Android|iPhone|iPad|iPod|CrOS/i.test(agent)) return { os: 'other', arch }
  const text = `${hint} ${agent} ${nav?.platform ?? ''}`
  if (/Windows|Win32|Win64/i.test(text)) return { os: 'windows', arch }
  if (/Mac/i.test(text)) return { os: 'macos', arch }
  if (/Linux|X11/i.test(text)) return { os: 'linux', arch }
  return { os: 'other', arch }
}

/** 3092225 -> "2.9 MB" */
export function formatSize(bytes) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
