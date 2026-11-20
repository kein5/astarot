// A page of the retired manual (../lib/manualRedirects.mjs). A script in the page's head
// (rspress.config.ts) sends the reader on before anything is drawn; this is the fallback, and its
// links stay for readers whose browser does not follow the redirect.
import { withBase } from '@rspress/core/runtime'
import { useEffect } from 'react'
import { preferredLocale } from '../lib/locale'

export default function ManualRedirect({ to }: { to: string }) {
  useEffect(() => {
    location.replace(withBase(`/${preferredLocale()}${to}`))
  }, [to])
  return (
    <div className="language-picker">
      <p lang="ja">
        ASTAROTユーザーマニュアルはガイドにまとめました。<a href={withBase(`/ja${to}`)}>ガイドのページを開く</a>
      </p>
      <p lang="en">
        The ASTAROT manual is now part of the guide. <a href={withBase(`/en${to}`)}>Open the guide page</a>
      </p>
    </div>
  )
}
