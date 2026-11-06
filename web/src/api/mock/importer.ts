/** CSV/JSON account-history import for the mock adapter. */
import type { AccountHistoryImportResult, AccountHistoryImportRow, MutableTransactionType } from '../types'
import type { ImportFile } from '../datasource'
import { minorToDecimal } from '@/lib/money'
import { majorToMinor, minorToMajor } from './decimal'

const TYPES: MutableTransactionType[] = [
  'deposit',
  'withdrawal',
  'interest',
  'dividend',
  'capital_gain',
  'capital_loss',
  'fee',
  'purchase',
  'sale',
  'manual_adjustment',
  'liability_payment',
  'liability_increase',
]

export interface ParsedRow {
  row: number
  externalId: string | null
  type: string
  amount: string
  date: string
  description: string | null
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

export function parseImport(file: ImportFile): ParsedRow[] {
  if (file.format === 'json') {
    const doc = JSON.parse(file.content) as { format?: string; version?: number; transactions?: Record<string, unknown>[] }
    if (!doc || doc.format !== 'wealthboard-account-history' || doc.version !== 1 || !Array.isArray(doc.transactions)) {
      throw new Error('JSON must use wealthboard-account-history format version 1.')
    }
    return doc.transactions.map((t, i) => ({
      row: i + 1,
      externalId: (t.external_id as string | null | undefined) ?? null,
      type: String(t.type ?? ''),
      amount: String(t.amount ?? ''),
      date: String(t.date ?? ''),
      description: (t.description as string | null | undefined) ?? null,
    }))
  }
  const lines = file.content.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) throw new Error('The CSV file needs a header row and at least one transaction.')
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase())
  const col = (name: string) => header.indexOf(name)
  // Mirrors the server: the header must match the template exactly, in order.
  if (header.join(',') !== 'external_id,type,amount,date,description,notes') throw new Error('the CSV headers do not match the required template')
  return lines.slice(1).map((line, i) => {
    const cells = splitCsvLine(line)
    const get = (name: string) => (col(name) >= 0 ? (cells[col(name)] ?? '') : '')
    return { row: i + 1, externalId: get('external_id') || null, type: get('type'), amount: get('amount'), date: get('date'), description: get('description') || null }
  })
}

export function evaluateImport(
  rows: ParsedRow[],
  opts: { currency: string; existingExternalIds: Set<string>; currentBalance: bigint; today: string },
): { rows: AccountHistoryImportRow[]; ready: ParsedRow[]; net: bigint; range: { from: string; to: string } | null } {
  const seen = new Set<string>()
  const derivedCounts = new Map<string, number>()
  const ready: ParsedRow[] = []
  let net = 0n
  const out: AccountHistoryImportRow[] = rows.map((source) => {
    const r = { ...source }
    const base = { row: r.row, externalId: r.externalId, transactionId: null, type: r.type, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : undefined }
    if (!TYPES.includes(r.type as MutableTransactionType)) return { ...base, status: 'error', code: 'invalid_type', message: `"${r.type || 'blank'}" is not a supported transaction type.` }
    if (!/^-?\d+(\.\d+)?$/.test(r.amount)) return { ...base, status: 'error', code: 'invalid_amount', message: `"${r.amount || 'blank'}" is not a valid amount.` }
    if (!base.date) return { ...base, status: 'error', code: 'invalid_date', message: 'Dates must be YYYY-MM-DD.' }
    if (base.date > opts.today) return { ...base, status: 'error', code: 'future_date', message: 'Transactions cannot be in the future.' }
    let minor: bigint
    try {
      minor = majorToMinor(r.amount, opts.currency)
    } catch {
      return { ...base, status: 'error', code: 'invalid_amount', message: 'Amount could not be read.' }
    }
    if (!r.externalId) {
      // Mirrors the server: date, type, and amount at currency precision, numbering same-day repeats.
      const derived = `derived-${base.date}-${r.type}-${minorToDecimal(minor.toString(), opts.currency)}`
      const occurrence = (derivedCounts.get(derived) ?? 0) + 1
      derivedCounts.set(derived, occurrence)
      r.externalId = base.externalId = occurrence > 1 ? `${derived}-${occurrence}` : derived
    }
    if (opts.existingExternalIds.has(r.externalId) || seen.has(r.externalId)) {
      return { ...base, amount: minorToMajor(minor, opts.currency), status: 'duplicate', code: 'duplicate_external_id', message: `Already imported as ${r.externalId}.` }
    }
    seen.add(r.externalId)
    ready.push(r)
    const negative = ['withdrawal', 'fee', 'capital_loss', 'sale', 'liability_payment'].includes(r.type)
    net += negative ? -(minor < 0n ? -minor : minor) : minor
    return { ...base, amount: minorToMajor(minor, opts.currency), status: 'ready', code: 'ok', message: 'Will be imported.' }
  })
  const dates = ready.map((r) => r.date).sort()
  return { rows: out, ready, net, range: dates.length ? { from: dates[0]!, to: dates.at(-1)! } : null }
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type { AccountHistoryImportResult }
