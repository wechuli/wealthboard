import { describe, expect, it } from 'vitest'
import { configurationHash } from './ai-meta'
import { parseDraft, draftFile } from './draft'

describe('conversion helpers', () => {
  it('fingerprints settings exactly like the server', async () => {
    // Vector produced by the Go configurationHash for the same inputs.
    const hash = await configurationHash(
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5', maxOutputTokens: 1200, updatedAt: '2026-11-03T05:59:30.783497Z' },
      'balance',
      'KES',
    )
    expect(hash).toBe('f3ca968315dce0b3868e8acd296f7f6ee47da6ed6682e7349c4fbe3db381cfa5')
  })

  it('reads the draft envelope and names the download by content', () => {
    const content = JSON.stringify({ format: 'wealthboard-account-history', version: 1, transactions: [{ external_id: 'x', type: 'deposit', amount: '10.00', date: '2026-09-01', description: null, notes: null }] })
    expect(parseDraft(content)?.collections).toEqual([{ name: 'transactions', records: [expect.objectContaining({ type: 'deposit' })] }])
    expect(draftFile(content, 'Equity Bank / Savings')).toEqual({ name: 'Equity Bank  Savings AI draft.json', type: 'application/json' })
    expect(parseDraft('external_id,type')).toBeNull()
    expect(draftFile('external_id,type', 'M-Pesa')).toEqual({ name: 'M-Pesa AI draft.csv', type: 'text/csv' })
  })
})
