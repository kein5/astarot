import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspress/core'
import type { Sidebar } from '@rspress/core'
import { LOCALE_KEY } from './theme/lib/locale'
import { MANUAL_REDIRECTS } from './theme/lib/manualRedirects.mjs'

const repo = 'https://github.com/kein5/astarot'
const site = 'https://kein5.github.io/astarot/'
const base = '/astarot/'
const component = (name: string) => fileURLToPath(new URL(`./theme/components/${name}`, import.meta.url))

// Pages live under /ja/ and /en/, which released apps, the READMEs and SUPPORT.md open. Rspress
// serves its default language without a prefix, so the default language is `mul` and owns only /,
// the language picker (ADR-016). Its entry in the language menu is hidden (theme/custom.css).
const DEFAULT_LANG = 'mul'

// / only picks a language. Its head sends the reader on before the page is drawn, so the picker
// does not show while the site's scripts load; it stays for readers without JavaScript. Same choice
// as preferredLocale() in theme/lib/locale.ts: the language picked in the menu, else the browser's.
const pickLanguage = (rest: string) => `(function () {
  var locale
  try { locale = localStorage.getItem(${JSON.stringify(LOCALE_KEY)}) } catch (e) {}
  if (locale !== 'ja' && locale !== 'en') {
    var languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]
    locale = languages.some(function (language) { return language && language.toLowerCase().indexOf('ja') === 0 }) ? 'ja' : 'en'
  }
  var root = document.documentElement
  root.style.visibility = 'hidden'
  try { location.replace(${JSON.stringify(base)} + locale + ${JSON.stringify(rest)}) } catch (e) { root.style.visibility = '' }
})()`

// Rspress links each page to the same page in the other language (hreflang, with siteOrigin);
// readers whose language is neither go to /, the language picker.
const xDefault = (routePath: string) =>
  routePath === '/' || /^\/(ja|en)\//.test(routePath)
    ? (['link', { rel: 'alternate', hreflang: 'x-default', href: site }] as [string, Record<string, string>])
    : undefined

const manualTarget = (routePath: string) => MANUAL_REDIRECTS.find((entry) => entry.path === routePath)?.to

// Both languages use the same page order and route suffixes.
const sidebarGroups = [
  {
    en: 'Getting started',
    ja: 'はじめに',
    pages: [
      { path: 'guide/introduction', en: 'What is ASTAROT', ja: 'ASTAROTとは' },
      { path: 'guide/install', en: 'Install', ja: 'インストール' },
      { path: 'guide/first-setup', en: 'First setup', ja: '最初の設定' },
      { path: 'guide/tasks', en: 'Find what you want to do', ja: 'やりたいことから探す' },
      { path: 'guide/how-it-works', en: 'How voice and text flow', ja: '声と文字の流れ' },
    ],
  },
  {
    en: 'Conversation',
    ja: '会話の基本',
    pages: [
      { path: 'features/translation', en: 'Translation', ja: '翻訳' },
      { path: 'features/transcription', en: 'Speech recognition (ASR) and realtime captions', ja: '音声認識（ASR）とリアルタイム字幕' },
      { path: 'features/vr', en: 'Captions and VR', ja: '字幕とVR' },
      { path: 'features/quick-chat', en: 'Quick Chat and hotkeys', ja: '入力の小窓とホットキー' },
    ],
  },
  {
    en: 'Voice and reading',
    ja: '声と読み取り',
    pages: [
      { path: 'features/tts', en: 'Text to speech (TTS)', ja: 'テキスト読み上げ（TTS）' },
      { path: 'features/voice-conversion', en: 'Voice changer (RVC)', ja: 'ボイスチェンジャー（RVC）' },
      { path: 'features/chat-reading', en: 'Chat reading (OCR)', ja: 'チャット読み取り（OCR）' },
    ],
  },
  {
    en: 'Audio routes and other apps',
    ja: '音声経路と連携',
    pages: [
      { path: 'features/io-flow', en: 'Inputs and outputs', ja: '入力と出力' },
      { path: 'guide/windows-audio', en: 'Windows audio route', ja: 'Windowsの音声経路' },
      { path: 'guide/linux-audio', en: 'Linux audio route', ja: 'Linuxの音声経路' },
      { path: 'features/integrations', en: 'OBS and WebSocket', ja: 'OBSとWebSocket' },
    ],
  },
  {
    en: 'Models',
    ja: 'モデル',
    pages: [
      { path: 'guide/models', en: 'Model downloads', ja: 'モデルの取得' },
      { path: 'guide/custom-models', en: 'Use your own models', ja: '自分のモデルを使う' },
    ],
  },
  {
    en: 'Help and reference',
    ja: '困ったときと資料',
    pages: [
      { path: 'guide/troubleshooting', en: 'Troubleshooting', ja: '困ったとき' },
      { path: 'guide/requirements', en: 'System requirements', ja: '動作環境と推奨スペック' },
      { path: 'guide/support', en: 'Platform support', ja: '対応環境と検証の範囲' },
      { path: 'guide/privacy', en: 'Privacy', ja: 'プライバシー' },
      { path: 'guide/license', en: 'License and credits', ja: 'ライセンスと謝辞' },
    ],
  },
]

const sidebarFor = (lang: 'en' | 'ja'): Sidebar => ({
  [`/${lang}/`]: sidebarGroups.map((group) => ({
    text: group[lang],
    items: group.pages.map((page) => ({ text: page[lang], link: `/${lang}/${page.path}` })),
  })),
})

// The theme's own words. Rspress has Japanese for them; these are the guide's words where they
// differ. The / page's language (`mul`) takes the English ones.
const WORDS: Record<string, { ja: string; en: string }> = {
  outlineTitle: { ja: 'このページの内容', en: 'On this page' },
  prevPageText: { ja: '前のページ', en: 'Previous page' },
  nextPageText: { ja: '次のページ', en: 'Next page' },
  scrollToTopText: { ja: 'ページの先頭へ', en: 'Back to top' },
  menuTitle: { ja: 'メニュー', en: 'Menu' },
  languagesText: { ja: '言語', en: 'Language' },
  searchPlaceholderText: { ja: '検索', en: 'Search' },
  searchPanelCancelText: { ja: '閉じる', en: 'Close' },
  searchNoResultsText: { ja: '見つかりませんでした', en: 'No results' },
  searchSuggestedQueryText: { ja: 'ほかの語で探してください', en: 'Try other words' },
  notFoundText: { ja: 'ページが見つかりません', en: 'Page not found' },
  takeMeHomeText: { ja: 'トップページへ', en: 'Go to the home page' },
  codeButtonGroupCopyButtonText: { ja: 'コードをコピー', en: 'Copy code' },
}

// Every picture in a page is a screenshot: it can take focus and opens larger (theme/index.tsx).
function rehypeZoomableImages() {
  type Node = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: Node[] }
  const walk = (node: Node) => {
    if (node.type === 'element' && node.tagName === 'img') {
      node.properties = { ...node.properties, dataZoom: '', tabIndex: 0, role: 'button', ariaHasPopup: 'dialog' }
    }
    node.children?.forEach(walk)
  }
  return (tree: Node) => walk(tree)
}

export default defineConfig({
  root: '.',
  base,
  siteOrigin: 'https://kein5.github.io',
  outDir: 'dist',
  title: 'ASTAROT',
  lang: DEFAULT_LANG,
  // ASTAROT's favicon at 32 px (docs/brand/astarot/favicon-32.png). Rsbuild would find
  // public/favicon.png by itself; naming it keeps the one link.
  icon: '/favicon.png',
  route: {
    // The content is the Markdown under ja/ and en/, and index.md (the language picker).
    extensions: ['.md', '.mdx'],
    exclude: ['motion/**', 'node_modules/**', 'theme/**', 'dist/**', 'public/**'],
    cleanUrls: true,
    // / picks the language itself (pickLanguage); a page opened by its address stays put.
    localeRedirect: 'never',
  },
  // English first, then Japanese, wherever the two languages stand side by side (decided
  // 2026-11-23). The order of the language menu follows these lists.
  locales: [
    { lang: DEFAULT_LANG, label: 'Language', title: 'ASTAROT' },
    {
      lang: 'en',
      label: 'English',
      title: 'ASTAROT',
      description: 'How to use ASTAROT, a translation, speech recognition, text-to-speech, voice conversion and chat-reading app for VRChat',
    },
    {
      lang: 'ja',
      label: '日本語',
      title: 'ASTAROT',
      description: 'VRChat向けの翻訳・音声認識・読み上げ・声の変換・チャット読み取りアプリASTAROTの使い方',
    },
  ],
  i18nSource: (source) => {
    const words = { ...source }
    for (const [key, value] of Object.entries(WORDS)) words[key] = { ...words[key], ...value }
    for (const key of Object.keys(words)) words[key] = { ...words[key], [DEFAULT_LANG]: words[key].en ?? '' }
    return words
  },
  head: [
    // The browser's own bar takes the canvas colour of each scheme (theme/tokens.css).
    ['meta', { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#fafafc' }],
    ['meta', { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#261633' }],
    // The favicon drawn again for 16 px with one-pixel lines (docs/brand/astarot/favicon-16.png),
    // for a tab of that size. The app icon, the symbol on a Dark Plum tile, is for home screens.
    ['link', { rel: 'icon', type: 'image/png', sizes: '16x16', href: `${base}favicon-16.png` }],
    ['link', { rel: 'apple-touch-icon', href: `${base}apple-touch-icon.png` }],
    (route) => (route.routePath === '/' ? `<script>${pickLanguage('/')}</script>` : undefined),
    (route) => xDefault(route.routePath),
    // The manual's pages send the reader on to the guide (theme/lib/manualRedirects.mjs). Their
    // HTML was Japanese, so readers without scripts go to the Japanese page.
    (route) => {
      const to = manualTarget(route.routePath)
      return to === undefined ? undefined : `<script>${pickLanguage(to)}</script>`
    },
    (route) => {
      const to = manualTarget(route.routePath)
      return to === undefined ? undefined : ['link', { rel: 'canonical', href: `${site}ja${to}` }]
    },
  ],
  plugins: [
    {
      name: 'astarot-manual-redirects',
      addPages: () =>
        MANUAL_REDIRECTS.map(({ path: routePath, to }) => ({
          routePath,
          content: `---\npageType: blank\ntitle: ASTAROT\nsearch: false\n---\n\n<ManualRedirect to="${to}" />\n`,
        })),
      // Readers without scripts go to the Japanese page, as the manual's HTML was Japanese. A
      // <meta> inside <noscript> in the head option is moved out of it and would refresh for every
      // reader, racing the script that picks the language, so it is written into the built pages.
      // These pages have the site's icons, as every page does.
      afterBuild: async (_config, isProd) => {
        if (!isProd) return
        const dist = fileURLToPath(new URL('./dist/', import.meta.url))
        for (const { path: routePath, to } of MANUAL_REDIRECTS) {
          const file = `${dist}${routePath.replace(/^\//, '').replace(/\/$/, '/index')}.html`
          const html = await readFile(file, 'utf8')
          const tags = `<noscript><meta http-equiv="refresh" content="0; url=${base}ja${to}"></noscript>`
          if (!html.includes(tags)) await writeFile(file, html.replace('</head>', `${tags}</head>`))
        }
      },
    },
  ],
  markdown: {
    rehypePlugins: [rehypeZoomableImages],
    globalComponents: [
      component('Term.tsx'),
      component('CopyText.tsx'),
      component('OsTabs.tsx'),
      component('OsTab.tsx'),
      component('StepProgress.tsx'),
      component('Needs.tsx'),
      component('FeatureRows.tsx'),
      component('PageToc.tsx'),
      component('ManualRedirect.tsx'),
    ],
  },
  search: { codeBlocks: true },
  // Not published before the move to Rspress; turning them on is a decision of its own.
  llms: false,
  webMcp: false,
  sitemap: false,
  // Screenshots open with the guide's own dialog, which keyboard users can open too.
  mediumZoom: false,
  themeConfig: {
    // Light and dark, following the OS, with Rspress's switch in the top bar (S-01 in
    // docs/design/site-redesign). The colours are in theme/tokens.css.
    darkMode: true,
    socialLinks: [{ icon: 'github', mode: 'link', content: repo }],
    locales: [
      { lang: DEFAULT_LANG, label: 'Language', nav: [], sidebar: {} },
      {
        lang: 'en',
        label: 'English',
        // The top bar points at the three pages a reader looks for first.
        nav: [
          { text: 'Guide', link: '/en/guide/introduction' },
          { text: 'Install', link: '/en/guide/install' },
          { text: 'Troubleshooting', link: '/en/guide/troubleshooting' },
        ],
        sidebar: sidebarFor('en'),
      },
      {
        lang: 'ja',
        label: '日本語',
        nav: [
          { text: 'ガイド', link: '/ja/guide/introduction' },
          { text: 'インストール', link: '/ja/guide/install' },
          { text: '困ったとき', link: '/ja/guide/troubleshooting' },
        ],
        sidebar: sidebarFor('ja'),
      },
    ],
  },
})
