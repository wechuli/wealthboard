import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { IDS } from '@/api/mock/fixtures'
import { setScenario } from '@/api/mock/scenario'
import AccountsPage from '@/features/accounts/AccountsPage'
import ImportPage from '@/features/imports/ImportPage'
import InstrumentPage from '@/features/instruments/InstrumentPage'
import { RecorderProvider } from '@/features/recording/recorder'
import { renderWithApp } from '@/test/render'
import AccountDetailPage from './AccountDetailPage'

/** Renders a route and waits for the session so queries settle under the signed-in user's key. */
async function renderRoute(route: string) {
  const result = renderWithApp(
    <RecorderProvider>
      <Routes>
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
        <Route path="/accounts/:accountId/import" element={<ImportPage />} />
        <Route path="/instruments/:instrumentId" element={<InstrumentPage />} />
      </Routes>
    </RecorderProvider>,
    { route },
  )
  await waitFor(() => expect(result.client.getQueryState(['session'])?.status).toBe('success'))
  await act(async () => {})
  return result
}

describe('accounts list', () => {
  it('groups by category with liabilities called out', async () => {
    setScenario({ data: 'full' })
    await renderRoute('/accounts')
    expect(await screen.findByRole('link', { name: 'Zimele Fixed Income Fund' })).toHaveAttribute('href', `/accounts/${IDS.zimele}`)
    expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument()
    expect(screen.getAllByText('Reduces net worth').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Owed').length).toBeGreaterThan(0)
  })

  it('renders the compact table and other groupings from the URL', async () => {
    setScenario({ data: 'full' })
    await renderRoute('/accounts?view=table&group=kind&sort=name')
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getAllByText('What you owe').length).toBeGreaterThan(0)
  })

  it('explains missing rates in the incomplete scenario', async () => {
    setScenario({ data: 'incomplete' })
    await renderRoute('/accounts?group=state')
    expect((await screen.findAllByText('Missing USD rate')).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Add rate' })[0]).toHaveAttribute('href', '/settings/currencies?add=USD-KES')
  })

  it('lists archived accounts with restore', async () => {
    setScenario({ data: 'full' })
    await renderRoute('/accounts?show=archived')
    expect(await screen.findByRole('link', { name: 'Mwangaza Sacco Shares' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
  })

  it('opens the import account picker', async () => {
    setScenario({ data: 'full' })
    await renderRoute('/accounts?import=1')
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('link', { name: /Zimele Fixed Income Fund/ })).toHaveAttribute('href', `/accounts/${IDS.zimele}/import`)
  })

  it('teaches new users', async () => {
    setScenario({ data: 'empty' })
    await renderRoute('/accounts')
    expect(await screen.findByText('Start with the account you check most')).toBeInTheDocument()
  })

  it('renders a designed error state', async () => {
    setScenario({ data: 'errors' })
    await renderRoute('/accounts')
    expect(await screen.findByText('Your accounts could not be loaded')).toBeInTheDocument()
  })
})

describe('account detail', () => {
  it('value-tracked fund leads with value and flows', async () => {
    setScenario({ data: 'full' })
    await renderRoute(`/accounts/${IDS.zimele}`)
    expect(await screen.findByRole('heading', { level: 1, name: /Zimele Fixed Income Fund/ })).toBeInTheDocument()
    expect(await screen.findByText('Flows since opening')).toBeInTheDocument()
    expect(await screen.findByText('Estimated gain')).toBeInTheDocument()
    expect(screen.getByText('Valuation history')).toBeInTheDocument()
  })

  it('land leads with change since purchase', async () => {
    setScenario({ data: 'full' })
    await renderRoute(`/accounts/${IDS.land}`)
    expect(await screen.findByText('Since purchase')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Update value' }).length).toBeGreaterThan(0)
  })

  it('position account shows holdings and no return number', async () => {
    setScenario({ data: 'full' })
    await renderRoute(`/accounts/${IDS.faida}`)
    expect(await screen.findByRole('heading', { name: 'Holdings' })).toBeInTheDocument()
    expect(screen.getByText('Return methodology unavailable for position-tracked accounts')).toBeInTheDocument()
    expect((await screen.findAllByRole('link', { name: /Safaricom/ })).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Buy' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update value' })).not.toBeInTheDocument()
  })

  it('opens a real stock split form from the account menu', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    const { router } = await renderRoute(`/accounts/${IDS.ibkr}`)
    await user.click(await screen.findByRole('button', { name: 'More account actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Stock split/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Stock split' })
    expect(await within(sheet).findByLabelText('Receive')).toHaveValue('2')
    expect(within(sheet).getByRole('button', { name: 'Record stock split' })).toBeEnabled()
    expect(router.state.location.search).toContain('action=split')
  })

  it('liability shows outstanding balance and payments', async () => {
    setScenario({ data: 'full' })
    await renderRoute(`/accounts/${IDS.loan}`)
    expect(await screen.findByText('Outstanding balance · you owe')).toBeInTheDocument()
    expect(await screen.findByText('Payments made')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument()
    expect(screen.queryByText('Estimated gain')).not.toBeInTheDocument()
  })

  it('explains incomplete values', async () => {
    setScenario({ data: 'incomplete' })
    await renderRoute(`/accounts/${IDS.ibkr}`)
    expect(await screen.findByText('Value in KES is unavailable')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add USD rate' })).toHaveAttribute('href', '/settings/currencies?add=USD-KES')
  })

  it('shows a not-found state', async () => {
    setScenario({ data: 'full' })
    await renderRoute('/accounts/00000000-0000-0000-0000-000000000000')
    expect(await screen.findByText("There's no account at this address")).toBeInTheDocument()
  })

  it('renders a designed error state', async () => {
    setScenario({ data: 'errors' })
    await renderRoute(`/accounts/${IDS.zimele}`)
    expect(await screen.findByText('This account could not be loaded')).toBeInTheDocument()
  })
})

describe('instrument', () => {
  it('shows latest price, history, and holdings', async () => {
    setScenario({ data: 'full' })
    await renderRoute(`/instruments/${IDS.kcbShares}`)
    expect(await screen.findByText('Latest price')).toBeInTheDocument()
    expect(await screen.findByText(/Last priced \d+ days ago/)).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Faida NSE Portfolio' })).toBeInTheDocument()
  })

  it('handles a missing price', async () => {
    setScenario({ data: 'incomplete' })
    await renderRoute(`/instruments/${IDS.kcbShares}`)
    expect(await screen.findByText('No price yet')).toBeInTheDocument()
  })
})

describe('history import', () => {
  it('previews and commits a CSV', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    await renderRoute(`/accounts/${IDS.zimele}/import`)
    expect(await screen.findByText('Drop a CSV or JSON file here')).toBeInTheDocument()
    const csv = 'external_id,type,amount,date,description,notes\nT-1,deposit,1500.00,2025-01-05,Top-up,\nT-2,bogus,10,2025-01-06,Bad,\n'
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await user.upload(input, new File([csv], 'history.csv', { type: 'text/csv' }))
    expect(await screen.findByText('Review before importing')).toBeInTheDocument()
    expect(screen.getByText(/1 row has errors/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import 1 transaction' }))
    expect(await screen.findByText('1 transaction imported')).toBeInTheDocument()
  })

  it('rejects other file types', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup({ applyAccept: false })
    await renderRoute(`/accounts/${IDS.zimele}/import`)
    await screen.findByText('Drop a CSV or JSON file here')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await user.upload(input, new File(['x'], 'statement.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText('That file can’t be used')).toBeInTheDocument()
  })

  it('offers investment history import for position-tracked accounts', async () => {
    setScenario({ data: 'full' })
    await renderRoute(`/accounts/${IDS.faida}/import`)
    expect(await screen.findByText('Drop an investment history file here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sample JSON' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Prefer your own AI tool/ })).toBeInTheDocument()
  })

  it('offers a copyable AI prompt and derives IDs for rows without one', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    await renderRoute(`/accounts/${IDS.zimele}/import`)
    await screen.findByText('Drop a CSV or JSON file here')
    await user.click(screen.getByRole('button', { name: /Prefer your own AI tool/ }))
    const prompt = (screen.getByLabelText('Conversion prompt') as HTMLTextAreaElement).value
    expect(prompt).toContain('external_id,type,amount,date,description,notes')
    expect(prompt).toContain('If the source has no ID, leave external_id empty')
    expect(prompt).not.toContain('would receive the same derived ID')

    const csv = 'external_id,type,amount,date,description,notes\n,deposit,1500.00,2025-01-05,Top-up,\n,deposit,1500,2025-01-05,Top-up,\n'
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await user.upload(input, new File([csv], 'history.csv', { type: 'text/csv' }))
    expect(await screen.findByText('Review before importing')).toBeInTheDocument()
    expect(screen.getAllByText(/derived-2025-01-05-deposit-1500\.00$/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/derived-2025-01-05-deposit-1500\.00-2$/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Import 2 transactions' })).toBeInTheDocument()
  })
})
