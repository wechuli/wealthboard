import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { IDS } from '@/api/mock/fixtures'
import { setScenario } from '@/api/mock/scenario'
import type { AccountConversionPreview } from '@/api/types'
import { RecorderProvider } from '@/features/recording/recorder'
import { renderWithApp } from '@/test/render'
import AccountDetailPage from './AccountDetailPage'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function renderRoute(route: string) {
  const result = renderWithApp(
    <RecorderProvider>
      <Routes>
        <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
      </Routes>
    </RecorderProvider>,
    { route },
  )
  await waitFor(() => expect(result.client.getQueryState(['session'])?.status).toBe('success'))
  await act(async () => {})
  return result
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('advanced workflow deep links', () => {
  it('?action=reconcile opens the reconcile sheet, explains mock problems, and clears the param on close', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    const { router } = await renderRoute(`/accounts/${IDS.faida}?action=reconcile`)
    const sheet = await screen.findByRole('dialog', { name: 'Reconcile to statement' })
    expect(await within(sheet).findByText(/None yet/)).toBeInTheDocument()
    expect(within(sheet).getByText(/never changes quantities, prices, cash/)).toBeInTheDocument()

    await user.type(within(sheet).getByLabelText('Reported total'), '1250000')
    await user.click(within(sheet).getByRole('button', { name: 'Save reconciliation' }))
    expect(await within(sheet).findByText('Not available in the mock')).toBeInTheDocument()

    await user.click(within(sheet).getAllByRole('button', { name: 'Close' })[0]!)
    await waitFor(() => expect(router.state.location.search).not.toContain('action'))
  })

  it('?action=corporate opens a chooser of the five actions', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    const { router } = await renderRoute(`/accounts/${IDS.faida}?action=corporate`)
    const sheet = await screen.findByRole('dialog', { name: 'Corporate actions' })
    for (const name of ['Stock split', 'Spin-off', 'Merger', 'Dividend reinvestment', 'In-kind transfer']) expect(within(sheet).getByRole('button', { name: new RegExp(name) })).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: /Merger/ }))
    await waitFor(() => expect(router.state.location.search).toContain('action=merger'))
    expect(await screen.findByRole('dialog', { name: 'Merger' })).toBeInTheDocument()
  })

  it('explains why conversion is not offered on a position-tracked account', async () => {
    setScenario({ data: 'full' })
    await renderRoute(`/accounts/${IDS.faida}?action=convert`)
    const sheet = await screen.findByRole('dialog', { name: 'Convert to position tracking' })
    expect(within(sheet).getByText(/already tracks units and prices/)).toBeInTheDocument()
  })

  it('?edit=1 opens the edit-account sheet', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    const { router } = await renderRoute(`/accounts/${IDS.zimele}?edit=1`)
    const sheet = await screen.findByRole('dialog', { name: 'Edit account' })
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.search).not.toContain('edit'))
  })
})

describe('stock split', () => {
  it('validates the ratio before sending, then submits exact strings with an idempotency key', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    const create = vi.spyOn(api.corporateActions, 'create')
    await renderRoute(`/accounts/${IDS.faida}?action=split`)
    const sheet = await screen.findByRole('dialog', { name: 'Stock split' })
    const receive = await within(sheet).findByLabelText('Receive')
    const every = within(sheet).getByLabelText('For every')
    const submit = within(sheet).getByRole('button', { name: 'Record stock split' })

    await user.clear(receive)
    await user.type(receive, '0')
    await user.click(submit)
    expect(await within(sheet).findByText('Enter a number greater than zero, such as 12.5')).toBeInTheDocument()

    await user.clear(receive)
    await user.type(receive, '1')
    await user.click(submit)
    expect(await within(sheet).findByText(/A ratio of 1 changes nothing/)).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()

    await user.clear(receive)
    await user.type(receive, '3')
    await user.clear(every)
    await user.type(every, '2')
    expect(within(sheet).getByText(/become/)).toBeInTheDocument()
    await user.click(submit)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const [kind, body, options] = create.mock.calls[0]!
    expect(kind).toBe('stock-splits')
    expect(body).toMatchObject({ accountId: IDS.faida, numerator: '3', denominator: '2' })
    expect((body as { instrumentId: string }).instrumentId).toMatch(UUID)
    expect(options.idempotencyKey).toMatch(UUID)
    expect(await within(sheet).findByText('Not available in the mock')).toBeInTheDocument()

    await user.click(submit)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create.mock.calls[1]![2].idempotencyKey).toBe(options.idempotencyKey)
  })
})

describe('trade editor', () => {
  it('?editTrade loads the trade and submits exact decimal strings with an idempotency key', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    const { router } = await renderRoute(`/accounts/${IDS.faida}`)
    const events = await api.accounts.positionEvents(IDS.faida, { limit: 100 })
    const trade = events.items.find((e) => e.type === 'buy' && !e.eventGroupId)!
    expect(trade).toBeDefined()
    const update = vi.spyOn(api.positionEvents, 'update').mockResolvedValue({ id: trade.id })

    await act(() => router.navigate(`/accounts/${IDS.faida}?editTrade=${trade.id}`))
    const sheet = await screen.findByRole('dialog', { name: 'Edit trade' })
    const quantity = await within(sheet).findByLabelText('Quantity')
    expect(quantity).toHaveValue(trade.quantity)
    expect(within(sheet).getByText(/Every event from/)).toBeInTheDocument()

    await user.clear(quantity)
    await user.type(quantity, '12.125')
    await user.click(within(sheet).getByRole('button', { name: 'Save and replay' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const [id, body] = update.mock.calls[0]!
    expect(id).toBe(trade.id)
    expect(body).toMatchObject({
      accountId: IDS.faida,
      instrumentId: trade.instrumentId,
      type: 'buy',
      quantity: '12.125',
      unitPrice: trade.unitPrice,
      tradeDate: trade.tradeDate,
      tradeCurrency: trade.tradeCurrency,
    })
    expect(body.idempotencyKey).toMatch(UUID)
    await waitFor(() => expect(router.state.location.search).not.toContain('editTrade'))
  })

  it('records an opening position without synthetic fees or cash', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    const create = vi.spyOn(api.positionEvents, 'create').mockResolvedValue({ id: crypto.randomUUID() })
    await renderRoute(`/accounts/${IDS.faida}?action=trade&trade=opening_position&instrument=${IDS.scom}`)
    const sheet = await screen.findByRole('dialog', { name: 'Record position activity' })
    await user.type(await within(sheet).findByLabelText('Quantity'), '1.125')
    await user.click(within(sheet).getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const body = create.mock.calls[0]![0]
    expect(body).toMatchObject({ accountId: IDS.faida, instrumentId: IDS.scom, type: 'opening_position', quantity: '1.125', tradeCurrency: 'KES' })
    expect(body.feeAmount).toBeUndefined()
    expect(body.cashEffect).toBeUndefined()
    expect(body.appliedExchangeRate).toBeUndefined()
    expect(body.idempotencyKey).toMatch(UUID)
  })
})

describe('convert to positions', () => {
  it('requires a preview and explicit confirmation of a difference before converting', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    const previewResult: AccountConversionPreview = {
      sourceAccountId: IDS.zimele,
      sourceAccountName: 'Zimele Fixed Income Fund',
      currency: 'KES',
      conversionDate: '2026-10-01',
      sourceBalanceMinor: '457691800',
      openingCashMinor: '0',
      positionsMinor: '185000',
      projectedTotalMinor: '185000',
      differenceMinor: '-457506800',
      holdings: [{ instrumentId: IDS.scom, name: 'Safaricom', symbol: 'SCOM', quantity: '100', price: '18.5', quoteCurrency: 'KES' }],
    }
    const preview = vi.spyOn(api.conversions, 'preview').mockResolvedValue(previewResult)
    const execute = vi.spyOn(api.conversions, 'execute').mockResolvedValue({ targetAccountId: IDS.faida, replayed: false })
    const { router } = await renderRoute(`/accounts/${IDS.zimele}?action=convert`)
    const sheet = await screen.findByRole('dialog', { name: 'Convert to position tracking' })
    const convert = within(sheet).getByRole('button', { name: 'Convert account' })
    expect(convert).toBeDisabled()

    const holding = within(sheet).getByRole('listitem', { name: 'Holding 1' })
    await waitFor(() => expect(within(holding).getAllByRole('option').length).toBeGreaterThan(1))
    await user.selectOptions(within(holding).getByLabelText('Instrument'), IDS.scom)
    await user.type(within(holding).getByLabelText('Quantity'), '100')
    await user.type(within(holding).getByLabelText('Unit price'), '18.5')
    await user.click(within(sheet).getByRole('button', { name: 'Preview conversion' }))

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1))
    const [body, { idempotencyKey }] = preview.mock.calls[0]!
    expect(body).toMatchObject({ sourceAccountId: IDS.zimele, openingCash: '0.00', holdings: [{ instrumentId: IDS.scom, quantity: '100', price: '18.5', priceSource: 'conversion' }] })
    expect(idempotencyKey).toMatch(UUID)
    expect(await within(sheet).findByText("The new account won't match the current value")).toBeInTheDocument()
    expect(convert).toBeDisabled()

    await user.click(within(sheet).getByLabelText(/checked the difference and want to convert anyway/))
    expect(convert).toBeEnabled()
    await user.click(convert)
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(execute.mock.calls[0]![0]).toMatchObject({ confirmDifference: true, sourceAccountId: IDS.zimele })
    expect(execute.mock.calls[0]![1].idempotencyKey).toBe(idempotencyKey)
    await waitFor(() => expect(router.state.location.pathname).toBe(`/accounts/${IDS.faida}`))
  })

  it('invalidates the preview when the inputs change', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    vi.spyOn(api.conversions, 'preview').mockResolvedValue({
      sourceAccountId: IDS.zimele,
      sourceAccountName: 'Zimele Fixed Income Fund',
      currency: 'KES',
      conversionDate: '2026-10-01',
      sourceBalanceMinor: '185000',
      openingCashMinor: '0',
      positionsMinor: '185000',
      projectedTotalMinor: '185000',
      differenceMinor: '0',
      holdings: [],
    })
    await renderRoute(`/accounts/${IDS.zimele}?action=convert`)
    const sheet = await screen.findByRole('dialog', { name: 'Convert to position tracking' })
    const holding = within(sheet).getByRole('listitem', { name: 'Holding 1' })
    await waitFor(() => expect(within(holding).getAllByRole('option').length).toBeGreaterThan(1))
    await user.selectOptions(within(holding).getByLabelText('Instrument'), IDS.scom)
    await user.type(within(holding).getByLabelText('Quantity'), '100')
    await user.type(within(holding).getByLabelText('Unit price'), '18.5')
    await user.click(within(sheet).getByRole('button', { name: 'Preview conversion' }))
    expect(await within(sheet).findByText('Matches')).toBeInTheDocument()
    const convert = within(sheet).getByRole('button', { name: 'Convert account' })
    expect(convert).toBeEnabled()
    await user.type(within(holding).getByLabelText('Quantity'), '0')
    expect(await within(sheet).findByText('The details changed since this preview')).toBeInTheDocument()
    expect(convert).toBeDisabled()
  })
})
