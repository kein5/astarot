// One tooltip for every <Term> on the page (TermTooltip.tsx draws it). Moving from one term to
// the next moves the same bubble, so it slides and changes its words instead of blinking.
import { useSyncExternalStore } from 'react'

export const TOOLTIP_ID = 'vox-term-tip'

export interface Tooltip {
  owner: number
  text: string
  /** The term's box in the viewport. */
  rect: { left: number; top: number; width: number; height: number }
  open: boolean
}

const closed: Tooltip = { owner: 0, text: '', rect: { left: 0, top: 0, width: 0, height: 0 }, open: false }
let tooltip: Tooltip = closed
const listeners = new Set<() => void>()

function set(next: Tooltip) {
  tooltip = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTooltip(): Tooltip {
  return useSyncExternalStore(subscribe, () => tooltip, () => closed)
}

let next = 0
export const newOwner = () => ++next

export const isOpenFor = (owner: number) => tooltip.open && tooltip.owner === owner

export function showTip(owner: number, text: string, element: HTMLElement) {
  const box = element.getBoundingClientRect()
  set({ owner, text, rect: { left: box.left, top: box.top, width: box.width, height: box.height }, open: true })
}

export function hideTip(owner?: number) {
  if (tooltip.open && (owner === undefined || tooltip.owner === owner)) set({ ...tooltip, open: false })
}
