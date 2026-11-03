import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { setScenario } from '@/api/mock/scenario'
import { RecorderProvider } from '@/features/recording/recorder'
import { renderWithApp } from '@/test/render'
import ActivityPage from './ActivityPage'

async function renderActivity(route = '/activity') {
  const r = renderWithApp(
    <RecorderProvider>
      <ActivityPage />
    </RecorderProvider>,
    { route },
  )
  // Let the session bootstrap and every query settle, so the tree is stable.
  await waitFor(() => expect(r.client.isFetching()).toBe(0))
  await waitFor(() => expect(r.client.isFetching()).toBe(0))
  return r
}

describe('activity ledger', () => {
  it('lists entries across accounts and loads more', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    await renderActivity()
    const table = await screen.findByRole('table', {
      name: /Activity across all accounts/,
    })
    const before = within(table).getAllByRole('row').length
    expect(before).toBeGreaterThan(10)
    await user.click(screen.getByRole('button', { name: 'Load 50 more' }))
    await screen.findByText(/^100 entries/)
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(before)
  })

  it('filters by kind from the URL and describes trades', async () => {
    setScenario({ data: 'full' })
    await renderActivity('/activity?kind=position')
    const table = await screen.findByRole('table', {
      name: /Activity across all accounts/,
    })
    expect(within(table).getAllByText(/^(Bought|Sold|Opening position)/).length).toBeGreaterThan(0)
    expect(within(table).queryByText('Valued at')).not.toBeInTheDocument()
  })

  it('shows a no-results state with clear filters', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    await renderActivity('/activity?q=zzzz-no-such-entry')
    expect(await screen.findByText('Nothing matches these filters')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!)
    expect(
      await screen.findByRole('table', {
        name: /Activity across all accounts/,
      }),
    ).toBeInTheDocument()
  })

  it('confirms that deleting a transfer removes both legs', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    await renderActivity('/activity?type=transfer')
    const table = await screen.findByRole('table', {
      name: /Activity across all accounts/,
    })
    const trigger = within(table).getAllByRole('button', {
      name: /^Actions for Transfer/,
    })[0]!
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: /Delete both legs/ }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete this transfer?',
    })
    expect(within(dialog).getByText(/Both will be deleted/)).toBeInTheDocument()
  })

  it('edits a deposit in a sheet', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    await renderActivity('/activity?type=deposit')
    const table = await screen.findByRole('table', {
      name: /Activity across all accounts/,
    })
    await user.click(
      within(table).getAllByRole('button', {
        name: /^Actions for Deposit/,
      })[0]!,
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const sheet = await screen.findByRole('dialog', {
      name: 'Edit transaction',
    })
    const amount = within(sheet).getByLabelText('Amount')
    expect((amount as HTMLInputElement).value).toMatch(/^\d+\.\d{2}$/)
  })

  it('teaches new users', async () => {
    setScenario({ data: 'empty' })
    await renderActivity()
    expect(await screen.findByText('Your ledger starts with your first entry')).toBeInTheDocument()
  })

  it('renders a designed error state', async () => {
    setScenario({ data: 'errors' })
    await renderActivity()
    expect(await screen.findByText("Activity couldn't be loaded")).toBeInTheDocument()
  })
})
