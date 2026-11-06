import { describe, expect, it } from 'vitest'
import { accountHistoryAiPrompt, FORMAT_LABELS, investmentHistoryAiPrompt, type InvestmentHistoryPromptFormat } from './ai-prompts'
import { CSV_HEADER, IMPORT_TYPES, INVESTMENT_CSV_HEADERS } from './sample'

// The prompt is the only guide an AI chat gets, so it must describe the exact format the import accepts.
describe('AI chat prompts', () => {
  it('ask for the account history import header, every import type, and the currency precision', () => {
    const csv = accountHistoryAiPrompt('csv', 'KES', 2)
    expect(csv).toContain(`  ${CSV_HEADER}\n`)
    for (const { type } of IMPORT_TYPES) expect(csv).toContain(type)
    expect(csv).toContain('exactly 2 decimal places for KES')
    expect(accountHistoryAiPrompt('json', 'JPY', 0)).toContain('exactly 0 decimal places for JPY')
  })

  it('ask for each investment CSV template header', () => {
    const templates: Record<Exclude<InvestmentHistoryPromptFormat, 'json'>, keyof typeof INVESTMENT_CSV_HEADERS> = {
      holdings_csv: 'holdings',
      trades_csv: 'trades',
      cash_csv: 'cash',
      prices_csv: 'prices',
    }
    for (const [format, template] of Object.entries(templates) as [Exclude<InvestmentHistoryPromptFormat, 'json'>, keyof typeof INVESTMENT_CSV_HEADERS][]) {
      expect(investmentHistoryAiPrompt(format, 'USD', 2, ['USD', 'KES']), FORMAT_LABELS[format]).toContain(`  ${INVESTMENT_CSV_HEADERS[template]}\n`)
    }
  })
})
