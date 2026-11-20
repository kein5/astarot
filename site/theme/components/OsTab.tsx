// One panel of <OsTabs> (OsTabs.tsx reads its `os` and its content).
import type { ReactNode } from 'react'

export default function OsTab({ children }: { os: 'windows' | 'linux'; children?: ReactNode }) {
  return <>{children}</>
}
