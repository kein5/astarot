// 「必要なもの」 before a task's steps, on the raised surface (custom.css `.needs`):
// <Needs>必要なもの: …</Needs>. It took the place of VitePress's `{.needs}` attribute.
import type { ReactNode } from 'react'

export default function Needs({ children }: { children?: ReactNode }) {
  return <div className="needs">{children}</div>
}
