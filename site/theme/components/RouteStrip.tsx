// The route strip at the top of a feature page: where voice and text go through the part this
// page sets up, with this page's step lit. A page names its route in its front matter
// (`route: tts`); the routes are in ../lib/routes.ts. Only this page's step is lit; the lane's
// name, not a colour, says whether it carries what you send or what comes back.
import { useFrontmatter, useLang } from '@rspress/core/runtime'
import { laneNames, routes } from '../lib/routes'
import styles from './RouteStrip.module.css'

export function RouteStrip() {
  const { frontmatter } = useFrontmatter()
  const key = useLang() === 'ja' ? 'ja' : 'en'
  const lanes = routes[frontmatter.route as string]
  if (!lanes) return null
  return (
    <div className={styles.routeStrip}>
      {lanes.map((lane) => (
        <div key={lane.side} className={styles.lane} role="group" aria-label={laneNames[lane.side][key]}>
          <span className={styles.laneName} aria-hidden="true">
            {laneNames[lane.side][key]}
          </span>
          <ol>
            {lane.nodes.map((node, index) => (
              <li key={index} aria-current={node.here ? 'step' : undefined}>
                {index > 0 && <span className={styles.wire} aria-hidden="true" />}
                <span className={[styles.node, node.here && styles.here].filter(Boolean).join(' ')}>{node[key]}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}
