import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { setMockLatency } from '@/api/mock/adapter'

setMockLatency(0)
import { cleanup } from '@testing-library/react'

afterEach(() => {
  if (typeof window === 'undefined') return
  cleanup()
  localStorage.clear()
})

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= RO as unknown as typeof ResizeObserver
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
}
