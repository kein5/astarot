// The latest release as the GitHub API gives it, trimmed to what the download button reads
// (components/DownloadButton.tsx). One answer is kept per tab and quarter hour: the API allows 60
// unsigned requests an hour per address.
import { LATEST_API } from './releases.mjs'

const CACHE_KEY = 'vrct-vox-guide-latest-release'
const CACHE_MS = 15 * 60 * 1000

export interface SlimRelease {
  tag_name?: unknown
  html_url?: unknown
  assets: { name?: unknown; size?: unknown; browser_download_url?: unknown }[]
}

export async function loadLatestRelease(controller: AbortController): Promise<SlimRelease> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null')
    if (saved && Date.now() - saved.at < CACHE_MS) return saved.release
  } catch {
    // Storage can be blocked; ask the API.
  }
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal })
    if (!response.ok) throw new Error(`GitHub API ${response.status}`)
    const data = await response.json()
    // Only what the pages read.
    const slim: SlimRelease = {
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
