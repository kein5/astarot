// The page's own contents as a compact index (custom.css `.table-of-contents`): <PageToc />.
// It took the place of VitePress's [[toc]] and lists the page's second-level headings.
import { useLang, usePage } from '@rspress/core/runtime'

export default function PageToc() {
  const { page } = usePage()
  const label = useLang() === 'ja' ? 'このページの内容' : 'On this page'
  const headings = (page.toc ?? []).filter((heading) => heading.depth === 2)
  if (!headings.length) return null
  return (
    <nav className="table-of-contents" aria-label={label}>
      <ul>
        {headings.map((heading) => (
          <li key={heading.id}>
            <a href={`#${heading.id}`}>{heading.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
