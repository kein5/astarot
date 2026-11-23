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

// Pages are grouped by what a reader comes to do: start, find a task, look a feature up, fix
// something. The voice and text features keep the order of the app's main switches; the screens
// and integrations follow them.
const sidebarJa: Sidebar = {
  '/ja/': [
    {
      text: 'はじめに',
      items: [
        { text: 'ASTAROTとは', link: '/ja/guide/introduction' },
        { text: 'インストール', link: '/ja/guide/install' },
        { text: '動作環境と推奨スペック', link: '/ja/guide/requirements' },
        { text: '対応環境と検証の範囲', link: '/ja/guide/support' },
        { text: '最初の設定', link: '/ja/guide/first-setup' },
        { text: '声と文字の流れ', link: '/ja/guide/how-it-works' },
      ],
    },
    {
      text: 'やりたいこと',
      items: [
        { text: 'やりたいことから探す', link: '/ja/guide/tasks' },
        { text: '自分のモデルを使う', link: '/ja/guide/custom-models' },
      ],
    },
    {
      text: '声と文字の機能',
      items: [
        { text: '翻訳', link: '/ja/features/translation' },
        { text: '音声認識（ASR）とリアルタイム字幕', link: '/ja/features/transcription' },
        { text: 'テキスト読み上げ（TTS）', link: '/ja/features/tts' },
        { text: 'ボイスチェンジャー（RVC）', link: '/ja/features/voice-conversion' },
        { text: 'チャット読み取り（OCR）', link: '/ja/features/chat-reading' },
      ],
    },
    {
      text: '画面と連携',
      items: [
        { text: '字幕とVR', link: '/ja/features/vr' },
        { text: '入力と出力', link: '/ja/features/io-flow' },
        { text: '入力の小窓とホットキー', link: '/ja/features/quick-chat' },
        { text: 'OBSとWebSocket', link: '/ja/features/integrations' },
      ],
    },
    {
      text: '設定と運用',
      items: [
        { text: 'モデルの取得', link: '/ja/guide/models' },
        { text: 'Windowsの音声経路', link: '/ja/guide/windows-audio' },
        { text: 'Linuxの音声経路', link: '/ja/guide/linux-audio' },
        { text: '困ったとき', link: '/ja/guide/troubleshooting' },
        { text: 'プライバシー', link: '/ja/guide/privacy' },
        { text: 'ライセンスと謝辞', link: '/ja/guide/license' },
      ],
    },
  ],
}

const sidebarEn: Sidebar = {
  '/en/': [
    {
      text: 'Getting started',
      items: [
        { text: 'What is ASTAROT', link: '/en/guide/introduction' },
        { text: 'Install', link: '/en/guide/install' },
        { text: 'System requirements', link: '/en/guide/requirements' },
        { text: 'Platform support', link: '/en/guide/support' },
        { text: 'First setup', link: '/en/guide/first-setup' },
        { text: 'How voice and text flow', link: '/en/guide/how-it-works' },
      ],
    },
    {
      text: 'What you want to do',
      items: [
        { text: 'Find what you want to do', link: '/en/guide/tasks' },
        { text: 'Use your own models', link: '/en/guide/custom-models' },
      ],
    },
    {
      text: 'Voice and text',
      items: [
        { text: 'Translation', link: '/en/features/translation' },
        { text: 'Speech recognition (ASR) and realtime captions', link: '/en/features/transcription' },
        { text: 'Text to speech (TTS)', link: '/en/features/tts' },
        { text: 'Voice changer (RVC)', link: '/en/features/voice-conversion' },
        { text: 'Chat reading (OCR)', link: '/en/features/chat-reading' },
      ],
    },
    {
      text: 'Screens and integrations',
      items: [
        { text: 'Captions and VR', link: '/en/features/vr' },
        { text: 'Inputs and outputs', link: '/en/features/io-flow' },
        { text: 'Quick Chat and hotkeys', link: '/en/features/quick-chat' },
        { text: 'OBS and WebSocket', link: '/en/features/integrations' },
      ],
    },
    {
      text: 'Setup and operation',
      items: [
        { text: 'Model downloads', link: '/en/guide/models' },
        { text: 'Windows audio route', link: '/en/guide/windows-audio' },
        { text: 'Linux audio route', link: '/en/guide/linux-audio' },
        { text: 'Troubleshooting', link: '/en/guide/troubleshooting' },
        { text: 'Privacy', link: '/en/guide/privacy' },
        { text: 'License and credits', link: '/en/guide/license' },
      ],
    },
  ],
}

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
  locales: [
    { lang: DEFAULT_LANG, label: 'Language', title: 'ASTAROT' },
    {
      lang: 'ja',
      label: '日本語',
      title: 'ASTAROT',
      description: 'VRChat向けの翻訳・音声認識・読み上げ・声の変換・チャット読み取りアプリASTAROTの使い方',
    },
    {
      lang: 'en',
      label: 'English',
      title: 'ASTAROT',
      description: 'How to use ASTAROT, a translation, speech recognition, text-to-speech, voice conversion and chat-reading app for VRChat',
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
        lang: 'ja',
        label: '日本語',
        // The top bar points at the three pages a reader looks for first.
        nav: [
          { text: 'ガイド', link: '/ja/guide/introduction' },
          { text: 'インストール', link: '/ja/guide/install' },
          { text: '困ったとき', link: '/ja/guide/troubleshooting' },
        ],
        sidebar: sidebarJa,
      },
      {
        lang: 'en',
        label: 'English',
        nav: [
          { text: 'Guide', link: '/en/guide/introduction' },
          { text: 'Install', link: '/en/guide/install' },
          { text: 'Troubleshooting', link: '/en/guide/troubleshooting' },
        ],
        sidebar: sidebarEn,
      },
    ],
  },
})
