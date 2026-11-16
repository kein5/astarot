// A menu button's behavior, as in components/DownloadButton.vue: the button opens the menu,
// arrows and Home/End move between its items, Esc closes it and returns focus to the button, and a
// press or focus elsewhere closes it.
import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useMenu(root: Ref<HTMLElement | null>, menu: Ref<HTMLElement | null>, toggle: Ref<HTMLElement | null>) {
  const open = ref(false)
  const items = () =>
    Array.from(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? [])

  function show(focus: 'first' | 'last' | 'current' = 'current') {
    open.value = true
    nextTick(() => {
      const list = items()
      const current = list.find((item) => item.dataset.current === 'true' || item.getAttribute('aria-checked') === 'true')
      const target = focus === 'last' ? list[list.length - 1] : focus === 'first' ? list[0] : (current ?? list[0])
      target?.focus()
    })
  }

  function hide(returnFocus = true) {
    if (!open.value) return
    open.value = false
    if (returnFocus) toggle.value?.focus()
  }

  function onToggleClick() {
    if (open.value) hide()
    else show()
  }

  function onToggleKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      show('current')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      show('last')
    }
  }

  function onMenuKey(event: KeyboardEvent) {
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLElement)
    const move = (to: number) => {
      event.preventDefault()
      list[(to + list.length) % list.length]?.focus()
    }
    switch (event.key) {
      case 'ArrowDown':
        return move(index + 1)
      case 'ArrowUp':
        return move(index - 1)
      case 'Home':
        return move(0)
      case 'End':
        return move(list.length - 1)
      case 'Escape':
        event.preventDefault()
        return hide()
      case 'Tab':
        return hide(false)
      case ' ':
        event.preventDefault()
        return (document.activeElement as HTMLElement | null)?.click()
    }
  }

  function onPointerDown(event: PointerEvent) {
    if (open.value && !root.value?.contains(event.target as Node)) hide(false)
  }
  function onFocusOut(event: FocusEvent) {
    if (open.value && !root.value?.contains(event.relatedTarget as Node | null)) hide(false)
  }

  onMounted(() => document.addEventListener('pointerdown', onPointerDown))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))

  return { open, show, hide, onToggleClick, onToggleKey, onMenuKey, onFocusOut }
}
