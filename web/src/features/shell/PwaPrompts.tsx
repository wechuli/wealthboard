import { useEffect, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { readStored, writeStored } from '@/lib/storage'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
}

/** Install prompt where the browser supports it (Chromium). */
export function useInstallPrompt(): { available: boolean; prompt(): void } {
  const available = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => deferred !== null,
    () => false,
  )
  return {
    available,
    prompt: () => {
      const d = deferred
      if (!d) return
      void d.prompt()
      void d.userChoice.finally(() => {
        deferred = null
        emit()
      })
    },
  }
}

/**
 * The service worker (/sw.js, registered from index.html in production) activates new versions
 * immediately. When control passes to a new worker, offer a reload so the page matches it.
 */
export function PwaPrompts() {
  const install = useInstallPrompt()

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return
    const onChange = () =>
      toast('An update is available', {
        id: 'pwa-update',
        description: 'Reload to get the latest version of Wealthboard.',
        duration: Infinity,
        action: { label: 'Reload', onClick: () => window.location.reload() },
      })
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange)
  }, [])

  useEffect(() => {
    if (!install.available || readStored('wealthboard-install-dismissed')) return
    toast('Install Wealthboard', {
      id: 'pwa-install',
      description: 'Open it like an app, with its own window and icon.',
      duration: 12_000,
      action: { label: 'Install', onClick: install.prompt },
      onDismiss: () => writeStored('wealthboard-install-dismissed', '1'),
    })
  }, [install.available, install.prompt])

  return null
}
