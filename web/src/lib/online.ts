import { useSyncExternalStore } from 'react'

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true)
}

export const OFFLINE_REASON = "You're offline. Changes need a connection to the server."
