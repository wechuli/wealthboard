import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { IDS } from '@/api/mock/fixtures'
import { LAST_RECORDING_KEY } from '@/config'
import { renderWithApp } from '@/test/render'
import { RecorderProvider, useRecorder, type RecorderOpenOptions } from './recorder'

function Launcher({ options }: { options?: RecorderOpenOptions }) {
  const recorder = useRecorder()
  return (
    <button type="button" onClick={() => recorder.open(options)}>
      Open quick add
    </button>
  )
}

function setup(options?: RecorderOpenOptions) {
  return renderWithApp(
    <RecorderProvider>
      <Launcher options={options} />
    </RecorderProvider>,
  )
}

describe('quick add', () => {
  it('offers every action and opens the chosen form', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(await screen.findByRole('button', { name: 'Open quick add' }))
    const sheet = await screen.findByRole('dialog', { name: 'Record something' })
    await within(sheet).findByRole('button', { name: /^Deposit/ })
    for (const label of ['Deposit', 'Withdrawal', 'Transfer', 'Update value', 'Update price', 'Buy', 'Sell', 'Interest', 'Dividend', 'Fee', 'New account', 'New goal']) {
      expect(within(sheet).getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument()
    }
    await user.click(within(sheet).getByRole('button', { name: /^Deposit/ }))
    expect(await screen.findByRole('dialog', { name: /Record a deposit/ })).toBeInTheDocument()
    expect(await screen.findByLabelText('Amount')).toHaveAttribute('inputmode', 'decimal')
  })

  it('offers only actions valid for a position-tracked account', async () => {
    const user = userEvent.setup()
    setup({ accountId: IDS.ibkr })
    await user.click(await screen.findByRole('button', { name: 'Open quick add' }))
    const sheet = await screen.findByRole('dialog', { name: 'Record something' })
    await within(sheet).findByText(/Actions for Interactive Brokers Brokerage/)
    expect(within(sheet).getByRole('button', { name: /^Buy/ })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^Update price/ })).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /^Update value/ })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /^Loan payment/ })).not.toBeInTheDocument()
  })

  it('offers liability actions for a loan and nothing that would misuse it', async () => {
    const user = userEvent.setup()
    setup({ accountId: IDS.loan })
    await user.click(await screen.findByRole('button', { name: 'Open quick add' }))
    const sheet = await screen.findByRole('dialog', { name: 'Record something' })
    await within(sheet).findByText(/Actions for NCBA Car Loan/)
    expect(within(sheet).getByRole('button', { name: /^Loan payment/ })).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /^Deposit/ })).not.toBeInTheDocument()
  })

  it('pre-selects the account it was launched from', async () => {
    const user = userEvent.setup()
    setup({ action: 'valuation', accountId: IDS.land })
    await user.click(await screen.findByRole('button', { name: 'Open quick add' }))
    const account = await screen.findByLabelText('Account')
    expect(account).toHaveValue(IDS.land)
  })

  it('remembers the most recent action and account', async () => {
    localStorage.setItem(LAST_RECORDING_KEY, JSON.stringify({ action: 'interest', accountId: IDS.madison }))
    const user = userEvent.setup()
    setup()
    await user.click(await screen.findByRole('button', { name: 'Open quick add' }))
    await user.click(await screen.findByRole('button', { name: /Repeat: Interest/ }))
    expect(await screen.findByRole('dialog', { name: /Record interest/ })).toBeInTheDocument()
    expect(await screen.findByLabelText('Account')).toHaveValue(IDS.madison)
  })
})

describe('deposit form', () => {
  it('validates, enforces currency precision, and submits minor units once', async () => {
    const spy = vi.spyOn(api.transactions, 'create')
    const user = userEvent.setup()
    setup({ action: 'deposit', accountId: IDS.zimele })
    await user.click(await screen.findByRole('button', { name: 'Open quick add' }))
    const submit = await screen.findByRole('button', { name: 'Record deposit' })
    await user.click(submit)
    expect(await screen.findByText('Enter an amount')).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()

    const amount = screen.getByLabelText('Amount')
    await user.type(amount, '1,250.555')
    // The third decimal is rejected as the user types: KES has two minor-unit digits.
    expect(amount).toHaveValue('1250.55')
    await user.dblClick(submit)
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    const body = spy.mock.calls[0]![0]
    expect(body).toMatchObject({ accountId: IDS.zimele, type: 'deposit', amountMinor: '125055' })
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByText(/Deposit of KES\s1,250\.55 recorded/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('shows a problem+json error on the field when a sale exceeds the holding', async () => {
    const user = userEvent.setup()
    setup({ action: 'sell', accountId: IDS.ibkr })
    await user.click(await screen.findByRole('button', { name: 'Open quick add' }))
    const instrument = await screen.findByLabelText('Instrument')
    await waitFor(() => expect(within(instrument).getAllByRole('option').length).toBeGreaterThan(1))
    await user.selectOptions(instrument, IDS.vwra)
    await user.type(screen.getByLabelText('Quantity'), '50')
    await user.type(screen.getByLabelText('Unit price'), '100')
    await user.click(screen.getByRole('button', { name: 'Record trade' }))
    expect(await screen.findByText('Not enough units')).toBeInTheDocument()
    expect(await screen.findByText(/At most 40/)).toBeInTheDocument()
  })
})
