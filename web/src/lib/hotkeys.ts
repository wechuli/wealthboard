import { useEffect, useRef } from 'react'

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function dialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
}

export interface HotkeyHandlers {
  onPalette(): void
  onQuickAdd(): void
  onPrivacy(): void
  onHelp(): void
  onGo(key: string): void
}

/** Global shortcuts: ⌘K / Ctrl K and "/" palette, N quick add, Shift H privacy, ? help, G then key. */
export function useGlobalHotkeys(handlers: HotkeyHandlers): void {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })
  useEffect(() => {
    let goPending = 0
    const onKey = (e: KeyboardEvent) => {
      const h = ref.current
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        h.onPalette()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || dialogOpen()) return
      const k = e.key
      if (goPending && Date.now() - goPending < 1200) {
        goPending = 0
        h.onGo(k.toLowerCase())
        e.preventDefault()
        return
      }
      if (k === '/') {
        e.preventDefault()
        h.onPalette()
      } else if (k === 'n' || k === 'N') {
        if (e.shiftKey) return
        e.preventDefault()
        h.onQuickAdd()
      } else if (k === 'H' && e.shiftKey) {
        e.preventDefault()
        h.onPrivacy()
      } else if (k === '?') {
        e.preventDefault()
        h.onHelp()
      } else if (k === 'g') {
        goPending = Date.now()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
