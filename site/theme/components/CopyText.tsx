// A value the reader may paste somewhere (a folder, an address), with a copy button:
// <CopyText>~/.config/astarot</CopyText>. The copy icon turns into a check for a moment.
import { useLang } from '@rspress/core/runtime'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import styles from './CopyText.module.css'

const WORDS = {
  ja: { copy: 'コピー', copied: 'コピーしました', select: '文字を選びました。Ctrl+C でコピーしてください' },
  en: { copy: 'Copy', copied: 'Copied', select: 'Selected: press Ctrl+C to copy' },
}

export default function CopyText({ children }: { children?: ReactNode }) {
  const words = useLang() === 'ja' ? WORDS.ja : WORDS.en
  const code = useRef<HTMLElement | null>(null)
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    const text = code.current?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      // Without the clipboard API (an insecure page, a blocked permission) select it instead.
      const range = document.createRange()
      if (code.current) range.selectNodeContents(code.current)
      getSelection()?.removeAllRanges()
      getSelection()?.addRange(range)
      setState('select')
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1800)
  }

  return (
    <span className={[styles.copyText, state !== 'idle' && styles[state]].filter(Boolean).join(' ')}>
      <code ref={code}>{children}</code>
      <button type="button" aria-label={words.copy} title={words.copy} onClick={copy}>
        <svg className={styles.iconCopy} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8.5" y="8.5" width="11" height="11" rx="3" />
          <path d="M15.5 8.5V7a2.5 2.5 0 0 0-2.5-2.5H7A2.5 2.5 0 0 0 4.5 7v6A2.5 2.5 0 0 0 7 15.5h1.5" />
        </svg>
        <svg className={styles.iconDone} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </button>
      <span className={styles.status} role="status">
        {state === 'copied' ? words.copied : state === 'select' ? words.select : ''}
      </span>
    </span>
  )
}
