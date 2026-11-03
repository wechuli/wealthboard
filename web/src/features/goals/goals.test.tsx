import { screen, waitFor, within } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { IDS } from '@/api/mock/fixtures'
import { setScenario } from '@/api/mock/scenario'
import { RecorderProvider } from '@/features/recording/recorder'
import { renderWithApp } from '@/test/render'
import GoalDetailPage from './GoalDetailPage'
import GoalsPage from './GoalsPage'

/** Waits until the session has bootstrapped and every query has settled, so the tree is stable. */
async function settle(client: QueryClient) {
  await waitFor(() => expect(client.isFetching()).toBe(0))
  await waitFor(() => expect(client.isFetching()).toBe(0))
}

async function renderGoals(route = '/goals') {
  const r = renderWithApp(
    <RecorderProvider>
      <GoalsPage />
    </RecorderProvider>,
    { route },
  )
  await settle(r.client)
  return r
}

async function renderDetail(goalId: string) {
  const r = renderWithApp(
    <RecorderProvider>
      <Routes>
        <Route path="/goals/:goalId" element={<GoalDetailPage />} />
      </Routes>
    </RecorderProvider>,
    { route: `/goals/${goalId}` },
  )
  await settle(r.client)
  return r
}

describe('goals overview', () => {
  it('shows counts, the behind reminder, and goal cards', async () => {
    setScenario({ data: 'full' })
    await renderGoals()
    expect(await screen.findByRole('heading', { level: 1, name: 'Goals' })).toBeInTheDocument()
    expect(await screen.findByText('2028 Family Car is behind plan')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dismiss for this month/ })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: /active goals? on track|active goal is on track/,
      }),
    ).toBeInTheDocument()
    const cards = screen.getByRole('list', { name: 'Active goals' })
    expect(within(cards).getByRole('link', { name: '2028 Family Car' })).toHaveAttribute('href', `/goals/${IDS.goalCar}`)
    expect(within(cards).queryByRole('link', { name: 'Japan trip' })).not.toBeInTheDocument()
  })

  it('filters by status from the URL', async () => {
    setScenario({ data: 'full' })
    await renderGoals('/goals?status=paused')
    const cards = await screen.findByRole('list', { name: 'Paused goals' })
    expect(within(cards).getByRole('link', { name: 'Japan trip' })).toBeInTheDocument()
    expect(within(cards).queryByRole('link', { name: '2028 Family Car' })).not.toBeInTheDocument()
  })

  it('teaches new users', async () => {
    setScenario({ data: 'empty' })
    await renderGoals()
    expect(await screen.findByText('Give your money somewhere to go')).toBeInTheDocument()
  })

  it('renders a designed error state', async () => {
    setScenario({ data: 'errors' })
    await renderGoals()
    expect(await screen.findByText("Goals couldn't be loaded")).toBeInTheDocument()
  })
})

describe('goal detail', () => {
  it('shows key numbers, scenarios, milestones, and the linked account', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    await renderDetail(IDS.goalCar)
    expect(await screen.findByRole('heading', { level: 1, name: /2028 Family Car/ })).toBeInTheDocument()
    expect(screen.getByText('Exploring only. These changes are not saved to your goal.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Saved plan' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Required pace' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lower return' })).toBeInTheDocument()
    expect(screen.getByText('No fees, taxes, or inflation are included.')).toBeInTheDocument()
    expect(await screen.findByText('First million')).toBeInTheDocument()

    const reset = screen.getByRole('button', { name: /Reset to saved plan/ })
    expect(reset).toBeDisabled()
    const monthly = screen.getByLabelText('Monthly contribution')
    await user.clear(monthly)
    await user.type(monthly, '200000')
    expect(reset).toBeEnabled()
    await user.click(reset)
    expect(reset).toBeDisabled()
  })

  it('confirms before marking complete', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    await renderDetail(IDS.goalCar)
    await user.click(await screen.findByRole('button', { name: /Mark complete/ }))
    const dialog = await screen.findByRole('dialog', {
      name: /Mark “2028 Family Car” as complete/,
    })
    expect(within(dialog).getByRole('button', { name: 'Mark complete' })).toBeInTheDocument()
  })

  it('explains incomplete goals with a fix link', async () => {
    setScenario({ data: 'incomplete' })
    await renderDetail(IDS.goalEtf)
    expect(await screen.findByText('Progress is incomplete')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Add (USD → KES rate|the rate)/ })[0]).toHaveAttribute('href', '/settings/currencies?add=USD-KES')
  })

  it('shows a not-found state for unknown ids', async () => {
    setScenario({ data: 'full' })
    await renderDetail('00000000-0000-4000-8000-000000000000')
    expect(await screen.findByText("This goal doesn't exist")).toBeInTheDocument()
  })
})

describe('goal editing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens from ?edit=1 and saves the full request with exact amounts and a percent return', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    const goal = await api.goals.get(IDS.goalEducation)
    const update = vi.spyOn(api.goals, 'update')
    const r = await renderDetail(`${IDS.goalEducation}?edit=1`)
    const sheet = await screen.findByRole('dialog', { name: /Edit Kids' education/ })
    expect(within(sheet).getByLabelText('Target amount')).toHaveValue('6000000.00')
    expect(within(sheet).getByLabelText('Assumed annual return')).toHaveValue('10')

    const target = within(sheet).getByLabelText('Target amount')
    await user.clear(target)
    await user.type(target, '6500000.5')
    const ret = within(sheet).getByLabelText('Assumed annual return')
    await user.clear(ret)
    await user.type(ret, '8.25')
    await user.click(within(sheet).getByRole('radio', { name: 'Piggy bank' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith(IDS.goalEducation, {
      name: "Kids' education",
      description: 'University fees for two, starting 2035.',
      icon: 'PiggyBank',
      currency: 'KES',
      targetAmount: '6500000.50',
      currentAmount: '1850000.00',
      targetDate: '2035-01-05',
      linkedAccountId: null,
      status: 'active',
      priority: 3,
      assumedAnnualReturn: 8.25,
      plannedContribution: '25000.00',
      frequency: 'monthly',
      planStartDate: goal.plan!.startDate,
      planEndDate: undefined,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(r.router.state.location.search).toBe('')
  })

  it('opens from the Edit action and validates before saving', async () => {
    setScenario({ data: 'full' })
    const user = userEvent.setup()
    const update = vi.spyOn(api.goals, 'update')
    await renderDetail(IDS.goalEducation)
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const sheet = await screen.findByRole('dialog', { name: /Edit Kids' education/ })
    const ret = within(sheet).getByLabelText('Assumed annual return')
    await user.clear(ret)
    await user.type(ret, '120')
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }))
    expect(await within(sheet).findByText('Use a percentage from 0 to 100 with up to two decimals')).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })
})
