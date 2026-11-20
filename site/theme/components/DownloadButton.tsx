// The home page's download button: the file for the reader's OS from the latest release, and a
// menu with every file, all versions and the source code. The built page holds a link to the
// releases page, so the button works before the script runs and when the GitHub API does not
// answer. Which file is which comes from ../lib/releases.mjs.
import { useLang, withBase } from '@rspress/core/runtime'
import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from 'react'
import { loadLatestRelease } from '../lib/latestRelease'
import { RELEASES_URL, REPO_URL, detectPlatform, formatSize, readRelease, recommend } from '../lib/releases.mjs'
import styles from './DownloadButton.module.css'

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
const OS_NAMES: Record<Os, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' }

function Chevron() {
  return (
    <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </svg>
  )
}

export function DownloadButton({ install }: { install: string }) {
  const words = useLang() === 'ja' ? WORDS.ja : WORDS.en
  const id = useId()
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [release, setRelease] = useState<Release | null>(null)
  const [platform, setPlatform] = useState<{ os: Os | 'other'; arch: 'x64' | 'arm64' }>({ os: 'other', arch: 'x64' })
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const menu = useRef<HTMLDivElement | null>(null)
  const toggle = useRef<HTMLButtonElement | null>(null)
  const focusOnOpen = useRef<'first' | 'last'>('first')

  // The API's answer is shared for a while per tab (../lib/latestRelease.ts).
  useEffect(() => {
    const controller = new AbortController()
    setPlatform(detectPlatform(navigator))
    setState('loading')
    loadLatestRelease(controller)
      .then((data) => {
        const read = readRelease(data) as Release
        if (!read.downloads.length) throw new Error('no downloads')
        setRelease(read)
        setState('ready')
      })
      .catch(() => setState('failed'))
    return () => controller.abort()
  }, [])

  const primary: Download | null =
    state === 'ready' && release && platform.os !== 'other' ? recommend(release.downloads, platform.os, platform.arch) : null

  const variantOf = (item: Download) =>
    [item.variant ? (words.variants[item.variant] ?? item.variant) : '', item.arch === 'arm64' ? 'ARM64' : ''].filter(Boolean).join(' · ')

  let note: string
  if (state === 'idle') note = words.idle
  else if (state === 'loading') note = words.loading
  else if (state === 'failed' || !release) note = words.failed
  else if (primary) note = [OS_NAMES[primary.os], words.formats[primary.format], variantOf(primary), formatSize(primary.size)].filter(Boolean).join(' · ')
  else if (platform.os === 'windows' || platform.os === 'linux') note = words.missing(OS_NAMES[platform.os])
  else note = words.unsupported(platform.os === 'macos' ? OS_NAMES.macos : words.thisOs)

  // ---------- The menu ----------

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  useEffect(() => {
    if (!open) return
    const list = items()
    const recommended = list.find((item) => item.dataset.recommended === 'true')
    ;(focusOnOpen.current === 'last' ? list[list.length - 1] : (recommended ?? list[0]))?.focus()
    // A press anywhere else closes it.
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function show(focus: 'first' | 'last' = 'first') {
    focusOnOpen.current = focus
    setOpen(true)
  }

  function hide(returnFocus = true) {
    setOpen(false)
    if (returnFocus) toggle.current?.focus()
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

  const toggleProps = {
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': `${id}-menu`,
    onClick: () => (open ? hide() : show()),
    onKeyDown: onToggleKey,
  }

  return (
    <div
      ref={root}
      className={styles.download}
      onBlur={(event) => {
        if (open && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div className={styles.split}>
        {primary || state !== 'ready' ? (
          <a className={styles.main} href={primary ? primary.url : `${RELEASES_URL}/latest`} aria-describedby={`${id}-note`}>
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
            </svg>
            <span>{words.download}</span>
            {release && <span className={styles.version}>{release.tag}</span>}
          </a>
        ) : (
          <button type="button" className={styles.main} aria-describedby={`${id}-note`} {...toggleProps}>
            <span>{words.choose}</span>
            {release && <span className={styles.version}>{release.tag}</span>}
          </button>
        )}
        <button ref={toggle} type="button" className={styles.toggle} aria-label={words.more} title={words.more} {...toggleProps}>
          <Chevron />
        </button>

        <div
          id={`${id}-menu`}
          ref={menu}
          className={styles.menu}
          role="menu"
          aria-label={words.menu}
          hidden={!open}
          onKeyDown={onMenuKey}
          onClick={onMenuClick}
        >
          {state === 'ready' && release ? (
            <>
              {release.groups.map((group) => (
                <div key={group.os} className={styles.group} role="group" aria-label={OS_NAMES[group.os]}>
                  <div className={styles.groupName} aria-hidden="true">
                    {OS_NAMES[group.os]}
                  </div>
                  {group.items.map((item) => (
                    <a
                      key={item.name}
                      className={styles.item}
                      role="menuitem"
                      tabIndex={-1}
                      href={item.url}
                      title={item.name}
                      data-recommended={item === primary}
                    >
                      <span className={styles.itemName}>
                        {words.formats[item.format] ?? item.format}
                        {variantOf(item) && <span className={styles.variant}>{variantOf(item)}</span>}
                      </span>
                      {item === primary && <span className={styles.badge}>{words.recommended}</span>}
                      <span className={styles.size}>{formatSize(item.size)}</span>
                    </a>
                  ))}
                </div>
              ))}
              {release.skipped > 0 && (
                <a className={`${styles.item} ${styles.link}`} role="menuitem" tabIndex={-1} href={release.page}>
                  {words.others(release.skipped)}
                </a>
              )}
            </>
          ) : (
            <p className={styles.status} aria-hidden="true">
              {note}
            </p>
          )}
          <div className={styles.separator} role="separator" />
          <a className={`${styles.item} ${styles.link}`} role="menuitem" tabIndex={-1} href={withBase(install)}>
            {words.install}
          </a>
          <a className={`${styles.item} ${styles.link}`} role="menuitem" tabIndex={-1} href={RELEASES_URL}>
            {words.all}
          </a>
          <a className={`${styles.item} ${styles.link}`} role="menuitem" tabIndex={-1} href={REPO_URL}>
            {words.source}
          </a>
        </div>
      </div>
      <p id={`${id}-note`} className={styles.note} aria-live="polite">
        {note}
      </p>
    </div>
  )
}
