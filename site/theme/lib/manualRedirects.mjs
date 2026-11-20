// Where the retired ASTAROT manual's pages send their readers (docs/design/site-redesign, 1.5).
// The manual was published at /manual/ and /manual/<chapter> from 0.5.0; its chapters only linked
// guide pages, so each one now opens the guide page that covered it, in the reader's language.
// rspress.config.ts builds a page for each path, components/ManualRedirect.tsx moves the reader on,
// and tools/check_site_manual.mjs checks that every target is built in both languages.

/** @type {{ path: string, to: string }[]} `to` is the page under /ja/ and /en/. */
export const MANUAL_REDIRECTS = [
  { path: '/manual/', to: '/' },
  { path: '/manual/introduction', to: '/guide/introduction' },
  { path: '/manual/install', to: '/guide/install' },
  { path: '/manual/screens', to: '/guide/how-it-works' },
  { path: '/manual/translation', to: '/features/translation' },
  { path: '/manual/speech', to: '/features/transcription' },
  { path: '/manual/voice', to: '/features/tts' },
  { path: '/manual/chat-reading', to: '/features/chat-reading' },
  { path: '/manual/audio-and-vr', to: '/features/io-flow' },
  { path: '/manual/models', to: '/guide/models' },
  { path: '/manual/help', to: '/guide/troubleshooting' },
]
