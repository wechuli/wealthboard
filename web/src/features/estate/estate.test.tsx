import { screen, waitFor, within } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '@/api'
import { IDS } from '@/api/mock/fixtures'
import { setScenario } from '@/api/mock/scenario'
import { PRIVACY_STORAGE_KEY } from '@/config'
import { renderWithApp } from '@/test/render'
import BeneficiariesPage from './BeneficiariesPage'
import DistributionPage from './DistributionPage'
import EstateLayout from './EstateLayout'
import EstateOverviewPage from './EstateOverviewPage'
import SnapshotPage from './SnapshotPage'
import SummaryPage from './SummaryPage'

async function settle(client: QueryClient) {
  await waitFor(() => expect(client.isFetching()).toBe(0))
  await waitFor(() => expect(client.isFetching()).toBe(0))
}

async function renderEstate(route: string) {
  const r = renderWithApp(
    <Routes>
      <Route path="/estate" element={<EstateLayout />}>
        <Route index element={<EstateOverviewPage />} />
        <Route path="beneficiaries" element={<BeneficiariesPage />} />
        <Route path="distribution" element={<DistributionPage />} />
        <Route path="summary" element={<SummaryPage />} />
      </Route>
      <Route path="/estate/snapshots/:snapshotId" element={<SnapshotPage />} />
    </Routes>,
    { route },
  )
  await settle(r.client)
  return r
}

beforeEach(() => {
  // Changing the scenario resets the mock's in-memory estate state between tests.
  setScenario({ data: 'empty' })
  setScenario({ data: 'full' })
})

describe('estate overview and plan details', () => {
  it('guides a new user to name the plan, then saves it', async () => {
    setScenario({ data: 'empty' })
    const user = userEvent.setup()
    await renderEstate('/estate')
    expect(screen.getByRole('heading', { level: 1, name: 'Estate planning' })).toBeInTheDocument()
    expect(screen.getByText('A planning aid, not a will')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Estate planning sections' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Start your estate plan' })).toBeInTheDocument()

    const form = screen.getByRole('form', { name: 'Plan details' })
    await user.click(within(form).getByRole('button', { name: 'Start my plan' }))
    expect(await within(form).findByText('Give the plan a title')).toBeInTheDocument()

    await user.type(within(form).getByLabelText('Plan title'), 'Fictional family plan')
    await user.type(within(form).getByLabelText(/Jurisdiction or residence/), 'Kenya')
    await user.type(within(form).getByLabelText(/Last reviewed/), '2026-10-15')
    await user.click(within(form).getByRole('button', { name: 'Start my plan' }))

    expect(await screen.findByText('Plan details saved')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Fictional family plan' })).toBeInTheDocument()
    expect(screen.getByText('Jurisdiction reference: Kenya')).toBeInTheDocument()
    const workspace = await api.estate.get()
    expect(workspace.plan).toMatchObject({ title: 'Fictional family plan', jurisdiction: 'Kenya' })
    expect(workspace.plan?.lastReviewedDate?.slice(0, 10)).toBe('2026-10-15')
  })

  it('renders a designed error state', async () => {
    setScenario({ data: 'errors' })
    await renderEstate('/estate')
    expect(await screen.findByText("Your estate plan couldn't be loaded")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('beneficiaries', () => {
  it('adds a beneficiary through the sheet', async () => {
    const user = userEvent.setup()
    await renderEstate('/estate/beneficiaries')
    const active = await screen.findByRole('list', { name: 'Active beneficiaries' })
    expect(within(active).getByText('Education trust')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add beneficiary' }))
    const sheet = await screen.findByRole('dialog', { name: 'Add beneficiary' })
    await user.click(within(sheet).getByText('Organization'))
    await user.type(within(sheet).getByLabelText('Name'), 'Fictional Community Library')
    await user.type(within(sheet).getByLabelText(/Relationship/), 'Charity')
    await user.type(within(sheet).getByLabelText(/Contact summary/), 'library@example.test')
    await user.click(within(sheet).getByRole('button', { name: 'Add beneficiary' }))

    expect(await screen.findByText('Fictional Community Library added')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const updated = await screen.findByRole('list', { name: 'Active beneficiaries' })
    expect(await within(updated).findByText('Fictional Community Library')).toBeInTheDocument()
    const created = (await api.estate.get()).beneficiaries.find((b) => b.name === 'Fictional Community Library')
    expect(created).toMatchObject({ kind: 'organization', relationship: 'Charity', contactSummary: 'library@example.test' })
  })
})

describe('distribution allocation tiers', () => {
  it('blocks a share that would take a tier over 100% and saves one that stays under', async () => {
    const user = userEvent.setup()
    await renderEstate(`/estate/distribution?account=${IDS.land}`)
    const sheet = await screen.findByRole('dialog', { name: 'Southern Bypass Land' })
    const primary = within(sheet).getByRole('region', { name: 'Primary beneficiaries' })
    expect(within(primary).getByText('100% allocated')).toBeInTheDocument()

    const form = within(primary).getByRole('form', { name: 'Add primary share' })
    await user.selectOptions(within(form).getByLabelText('Primary beneficiary'), 'Education trust')
    await user.type(within(form).getByLabelText('Share'), '10')
    expect(within(form).getByText('Over by 10%. This tier is already at 100%; lower another share first.')).toBeInTheDocument()
    expect(within(form).getByText('Primary beneficiaries would total 110%, 10% over 100%.')).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Add share' })).toBeDisabled()

    // Saving is an upsert per beneficiary and tier: lowering Child A's 50% to 30% leaves 20%.
    await user.selectOptions(within(form).getByLabelText('Primary beneficiary'), 'Child A')
    await user.clear(within(form).getByLabelText('Share'))
    await user.type(within(form).getByLabelText('Share'), '30')
    expect(within(form).getByText('Replaces their current 50%. Primary beneficiaries will total 80%, leaving 20%.')).toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: 'Update share' }))

    expect(await screen.findByText('Child A · 30% primary share of Southern Bypass Land saved')).toBeInTheDocument()
    expect(await within(primary).findByText('80% allocated · 20% remaining')).toBeInTheDocument()
  })

  it('rejects percentages with more than two decimals before sending', async () => {
    const user = userEvent.setup()
    await renderEstate(`/estate/distribution?account=${IDS.land}`)
    const sheet = await screen.findByRole('dialog', { name: 'Southern Bypass Land' })
    const contingent = within(sheet).getByRole('region', { name: 'Contingent beneficiaries' })
    const form = within(contingent).getByRole('form', { name: 'Add contingent share' })
    await user.selectOptions(within(form).getByLabelText('Contingent beneficiary'), 'Wanjiru (spouse)')
    await user.clear(within(form).getByLabelText('Share'))
    await user.type(within(form).getByLabelText('Share'), '33.333')
    await user.click(within(form).getByRole('button', { name: 'Update share' }))
    expect(await within(form).findByText('Use at most two decimal places')).toBeInTheDocument()
  })

  it('lists liabilities separately and never offers them a directive', async () => {
    await renderEstate('/estate/distribution')
    const liabilities = await screen.findByRole('list', { name: 'Recorded liabilities' })
    expect(within(liabilities).getByText('NCBA Car Loan')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /NCBA Car Loan/ })).not.toBeInTheDocument()
  })
})

describe('summary snapshots and print privacy', () => {
  async function seedSnapshot() {
    await api.estate.createBeneficiary({ kind: 'person', name: 'Fictional Contact Person', contactSummary: 'contact@example.test', notes: 'Fictional private note' })
    await api.estate.upsertDirective(IDS.land, {
      isIncluded: true,
      ownershipShareBps: 5000,
      transferContext: 'estate',
      distributionMethod: 'transfer_asset',
      documentReference: 'Fictional deed box 7',
    })
    return api.estate.createSnapshot()
  }

  it('excludes values, contacts, references, and notes until each is included', async () => {
    const snapshot = await seedSnapshot()
    const user = userEvent.setup()
    await renderEstate(`/estate/snapshots/${snapshot.id}`)

    const article = await screen.findByRole('article', { name: 'Estate Planning Summary' })
    expect(within(article).getByRole('heading', { level: 1, name: 'Family estate plan' })).toBeInTheDocument()
    for (const name of ['Include exact values', 'Include contacts', 'Include account and document references', 'Include private notes'])
      expect(screen.getByRole('checkbox', { name: new RegExp(name) })).not.toBeChecked()

    expect(within(article).getAllByText('Value excluded').length).toBeGreaterThan(0)
    expect(within(article).queryByText(/5,000,000\.00/)).not.toBeInTheDocument()
    expect(within(article).queryByText(/contact@example\.test/)).not.toBeInTheDocument()
    expect(within(article).queryByText(/Fictional deed box 7/)).not.toBeInTheDocument()
    expect(within(article).queryByText('Fictional private note')).not.toBeInTheDocument()
    expect(within(article).getAllByText('50%').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('checkbox', { name: /Include exact values/ }))
    expect(within(article).queryAllByText('Value excluded')).toHaveLength(0)
    expect(within(article).getAllByText(/5,000,000\.00/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('checkbox', { name: /Include contacts/ }))
    expect(within(article).getByText('Contact: contact@example.test')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Include account and document references/ }))
    expect(within(article).getByText('Document reference: Fictional deed box 7')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Include private notes/ }))
    expect(within(article).getByText('Fictional private note')).toBeInTheDocument()
  })

  it('keeps values masked in privacy mode even when included', async () => {
    const snapshot = await seedSnapshot()
    localStorage.setItem(PRIVACY_STORAGE_KEY, 'true')
    const user = userEvent.setup()
    await renderEstate(`/estate/snapshots/${snapshot.id}`)
    const article = await screen.findByRole('article', { name: 'Estate Planning Summary' })
    await user.click(screen.getByRole('checkbox', { name: /Include exact values/ }))
    expect(within(article).getAllByLabelText('Hidden value').length).toBeGreaterThan(0)
    expect(within(article).queryByText(/5,000,000\.00/)).not.toBeInTheDocument()
    expect(screen.getByText('Values stay masked while privacy mode is on')).toBeInTheDocument()
  })

  it('creates a retained summary from the summary view and lists it', async () => {
    const user = userEvent.setup()
    const r = await renderEstate('/estate/summary')
    expect(await screen.findByRole('heading', { name: 'Completion review' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create summary' }))
    expect(await screen.findByText('Summary retained')).toBeInTheDocument()
    await waitFor(() => expect(r.router.state.location.pathname).toMatch(/^\/estate\/snapshots\//))
    expect(await screen.findByRole('checkbox', { name: /Include exact values/ })).not.toBeChecked()
  })

  it('lists retained summaries with a hash prefix and deletes one after confirmation', async () => {
    const snapshot = await api.estate.createSnapshot()
    const user = userEvent.setup()
    await renderEstate('/estate/summary')
    const list = await screen.findByRole('list', { name: 'Retained summaries' })
    expect(within(list).getByText(`${snapshot.contentHash.slice(0, 12)}…`)).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: /Open summary of/ })).toHaveAttribute('href', `/estate/snapshots/${snapshot.id}`)

    await user.click(within(list).getByRole('button', { name: /Delete summary of/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this retained summary?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete summary' }))
    expect(await screen.findByText('No summaries retained yet')).toBeInTheDocument()
    expect((await api.estate.get()).snapshots).toHaveLength(0)
  })
})
