// The reader's OS for <OsTabs>: one choice for every tab on every page. It starts from the
// browser's own OS and is remembered once the reader picks one (localStorage; blocked storage
// just means it is not remembered).
import { useSyncExternalStore } from 'react'

export type Os = 'windows' | 'linux'
export const OS_KEY = 'vrct-vox-guide-os'

let os: Os = 'windows'
let started = false
const listeners = new Set<() => void>()

const valid = (value: unknown): value is Os => value === 'windows' || value === 'linux'
const emit = () => listeners.forEach((listener) => listener())

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  // A choice made in another tab of the guide follows here.
  addEventListener('storage', (event) => {
    if (event.key === OS_KEY && valid(event.newValue)) {
      os = event.newValue
      emit()
    }
  })
  try {
    const saved = localStorage.getItem(OS_KEY)
    if (valid(saved)) {
      os = saved
      return
    }
  } catch {
    // Storage can be blocked.
  }
  const agent = navigator.userAgent
  if (/Linux/.test(agent) && !/Android/.test(agent)) os = 'linux'
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!started) {
    start()
    emit()
  }
  return () => {
    listeners.delete(listener)
  }
}

/** The OS every <OsTabs> shows. The built page shows Windows until the script runs. */
export function useOs(): Os {
  return useSyncExternalStore(subscribe, () => os, () => 'windows')
}

export function chooseOs(value: Os) {
  os = value
  emit()
  try {
    localStorage.setItem(OS_KEY, value)
  } catch {
    // Not remembered; this page still follows the choice.
  }
}
