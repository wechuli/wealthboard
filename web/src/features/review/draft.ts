/** Helpers for the AI conversion draft: reading its envelope, naming the file, and handing it off. */

export type DraftRecord = Record<string, string | null>

export interface ParsedDraft {
  format: string | null
  collections: { name: string; records: DraftRecord[] }[]
}

const COLLECTION_LABELS: Record<string, string> = {
  transactions: 'Transactions',
  instruments: 'Instruments',
  position_events: 'Trades and holdings',
  cash_transactions: 'Cash movements',
  prices: 'Prices',
}

export const collectionLabel = (name: string) => COLLECTION_LABELS[name] ?? name.replace(/_/g, ' ')

/** Parses the draft JSON envelope. Returns null when the content isn't a JSON object (for example, after a bad edit). */
export function parseDraft(content: string): ParsedDraft | null {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const collections = Object.entries(record)
    .filter(([, v]) => Array.isArray(v))
    .map(([name, v]) => ({
      name,
      records: (v as unknown[]).filter((r): r is DraftRecord => !!r && typeof r === 'object' && !Array.isArray(r)),
    }))
  return { format: typeof record.format === 'string' ? record.format : null, collections }
}

/** The file to hand to Direct import: JSON when the draft parses, otherwise CSV text as-is. */
export function draftFile(content: string, accountName: string): { name: string; type: string } {
  const base = `${accountName.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'account'} AI draft`
  return parseDraft(content) ? { name: `${base}.json`, type: 'application/json' } : { name: `${base}.csv`, type: 'text/csv' }
}

export function downloadText(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
