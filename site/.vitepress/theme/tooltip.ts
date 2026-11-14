// One tooltip for every <Term> on the page (TermTooltip.vue draws it). Moving from one term to
// the next moves the same bubble, so it slides and changes its words instead of blinking.
import { reactive } from 'vue'

export const TOOLTIP_ID = 'vox-term-tip'

export const tooltip = reactive({
  owner: 0,
  text: '',
  // The term's box in the viewport.
  rect: { left: 0, top: 0, width: 0, height: 0 },
  open: false,
})

let next = 0
export const newOwner = () => ++next

export function showTip(owner: number, text: string, element: HTMLElement) {
  const box = element.getBoundingClientRect()
  tooltip.owner = owner
  tooltip.text = text
  tooltip.rect = { left: box.left, top: box.top, width: box.width, height: box.height }
  tooltip.open = true
}

export function hideTip(owner?: number) {
  if (owner === undefined || tooltip.owner === owner) tooltip.open = false
}
