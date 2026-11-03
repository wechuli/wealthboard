import type { EstateSnapshot } from '@/api/types'

/** Saves the full retained snapshot as JSON. Print privacy choices do not apply to this file. */
export function downloadSnapshotJson(snapshot: EstateSnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `estate-summary-v${snapshot.version}-${snapshot.generatedAt.slice(0, 10)}.json`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}
