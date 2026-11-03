import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { IDS } from '@/api/mock/fixtures'
import { setScenario } from '@/api/mock/scenario'
import type { InvestmentHistoryImportResult } from '@/api/types'
import { renderWithApp } from '@/test/render'
import ImportPage from './ImportPage'

async function renderImport() {
  const result = renderWithApp(
    <Routes>
      <Route path="/accounts/:accountId/import" element={<ImportPage />} />
    </Routes>,
    { route: `/accounts/${IDS.faida}/import` },
  )
  await waitFor(() => expect(result.client.getQueryState(['session'])?.status).toBe('success'))
  await act(async () => {})
  await screen.findByText('Drop an investment history file here')
  return result
}

const envelope = JSON.stringify({ format: 'wealthboard-investment-history', version: 1, instruments: [], position_events: [], cash_transactions: [], prices: [] })

async function upload(user: ReturnType<typeof userEvent.setup>) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  await user.upload(input, new File([envelope], 'history.json', { type: 'application/json' }))
}

function result(overrides: Partial<InvestmentHistoryImportResult> = {}): InvestmentHistoryImportResult {
  return {
    hash: 'a'.repeat(64),
    account: { id: IDS.faida, name: 'Faida NSE Portfolio', currency: 'KES' },
    current: { cashMinor: 100000, positionsMinor: 500000, totalMinor: 600000, complete: true, missingPrices: [], missingCurrencies: [] },
    projected: { cashMinor: 180000, positionsMinor: 750000, totalMinor: 930000, complete: false, missingPrices: ['Sample Bond Fund'], missingCurrencies: ['USD'] },
    netChangeMinor: 330000,
    dateRange: { from: '2026-09-01', to: '2026-09-10' },
    instrumentChanges: [
      { instrumentId: IDS.scom, externalId: 'inst:scom', name: 'Safaricom', symbol: 'SCOM', resolution: 'existing', currentQuantity: '100', projectedQuantity: '150', quantityChange: '50' },
    ],
    eventChanges: [{ externalId: 'ev:1', instrumentId: IDS.scom, type: 'buy', tradeDate: '2026-09-05', eventSequence: 1, beforeQuantity: '100', afterQuantity: '150' }],
    priceChanges: [{ externalId: 'price:1', instrumentId: IDS.scom, price: '19.25', currency: 'KES', source: 'statement', affectedFrom: '2026-09-10' }],
    summary: { records: 3, ready: 3, skippedDuplicates: 0, failed: 0 },
    canCommit: true,
    rows: [
      { collection: 'position_events', row: 1, externalId: 'ev:1', status: 'ready', code: 'ready', message: 'Ready to import.' },
      { collection: 'cash_transactions', row: 1, externalId: 'cash:1', status: 'ready', code: 'ready', message: 'Ready to import.' },
      { collection: 'prices', row: 1, externalId: 'price:1', status: 'ready', code: 'ready', message: 'Ready to import.' },
    ],
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('investment history import', () => {
  it('renders the mock 501 problem as a notice', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    await renderImport()
    await upload(user)
    expect(await screen.findByText('Not available in the mock')).toBeInTheDocument()
    expect(screen.getByText(/needs the real server/)).toBeInTheDocument()
  })

  it('previews values, completeness, changes, and gates commit on canCommit', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    vi.spyOn(api.imports, 'previewInvestmentHistory').mockResolvedValue(
      result({
        canCommit: false,
        summary: { records: 3, ready: 2, skippedDuplicates: 0, failed: 1 },
        eventChanges: [{ externalId: 'ev:1', instrumentId: IDS.scom, type: 'sell', tradeDate: '2026-09-05', eventSequence: 1, beforeQuantity: '100', afterQuantity: '-50' }],
        rows: [
          { collection: 'position_events', row: 1, externalId: 'ev:1', status: 'ready', code: 'ready', message: 'Ready to import.' },
          { collection: 'position_events', row: 0, externalId: null, status: 'failed', code: 'invalid_replay', message: 'a position cannot have a negative quantity' },
        ],
      }),
    )
    const commit = vi.spyOn(api.imports, 'commitInvestmentHistory')
    await renderImport()
    await upload(user)

    expect(await screen.findByText('Review before importing')).toBeInTheDocument()
    const values = screen.getByRole('table', { name: /Current and projected value/ })
    expect(within(values).getByRole('rowheader', { name: 'Total' })).toBeInTheDocument()
    expect(screen.getByText('The projected value will be incomplete')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add USD rate' })).toHaveAttribute('href', '/settings/currencies?add=USD-KES')
    expect(screen.getByText('1 event takes a holding below zero')).toBeInTheDocument()
    expect(screen.getAllByText('a position cannot have a negative quantity').length).toBeGreaterThan(0)
    expect(screen.getByText(/all or nothing/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Import 2 records/ })).toBeDisabled()
    expect(commit).not.toHaveBeenCalled()
  })

  it('commits exactly the previewed file with its hash when canCommit', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    const preview = vi.spyOn(api.imports, 'previewInvestmentHistory').mockResolvedValue(result())
    const commit = vi
      .spyOn(api.imports, 'commitInvestmentHistory')
      .mockResolvedValue(result({ summary: { records: 3, imported: 3, skippedDuplicates: 0, failed: 0 }, finalBalanceMinor: 930000, canCommit: false }))
    await renderImport()
    await upload(user)
    const button = await screen.findByRole('button', { name: /^Import 3 records/ })
    expect(button).toBeEnabled()
    expect(screen.getAllByText('Safaricom').length).toBeGreaterThan(0)
    await user.click(button)
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    const [accountId, file, hash] = commit.mock.calls[0]!
    expect(accountId).toBe(IDS.faida)
    expect(file).toEqual(preview.mock.calls[0]![1])
    expect(file.content).toBe(envelope)
    expect(hash).toBe('a'.repeat(64))
    expect(await screen.findByText('3 records imported')).toBeInTheDocument()
  })
})
