// A short list of features: the name (a link) in its own column and one line of what it does
// (custom.css `.feature-rows`). Wrap the Markdown list, with blank lines inside:
// <FeatureRows>, a blank line, the list, a blank line, </FeatureRows>.
import type { ReactNode } from 'react'

export default function FeatureRows({ children }: { children?: ReactNode }) {
  return <div className="feature-rows">{children}</div>
}
