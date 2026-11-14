// The reader's OS for <OsTabs>: one choice for every tab on every page. It starts from the
// browser's own OS and is remembered once the reader picks one (localStorage; blocked storage
// just means it is not remembered).
import { ref } from 'vue'

export type Os = 'windows' | 'linux'
export const OS_KEY = 'vrct-vox-guide-os'
export const os = ref<Os>('windows')

const valid = (value: unknown): value is Os => value === 'windows' || value === 'linux'
let started = false

export function startOs() {
  if (started || typeof window === 'undefined') return
  started = true
  // A choice made in another tab of the guide follows here.
  addEventListener('storage', (event) => {
    if (event.key === OS_KEY && valid(event.newValue)) os.value = event.newValue
  })
  try {
    const saved = localStorage.getItem(OS_KEY)
    if (valid(saved)) {
      os.value = saved
      return
    }
  } catch {
    // Storage can be blocked.
  }
  const agent = navigator.userAgent
  if (/Linux/.test(agent) && !/Android/.test(agent)) os.value = 'linux'
}

export function chooseOs(value: Os) {
  os.value = value
  try {
    localStorage.setItem(OS_KEY, value)
  } catch {
    // Not remembered; this page still follows the choice.
  }
}
