import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import type { Dashboard } from '@/api/types'
import { renderWithApp } from '@/test/render'
import { AttentionPanel } from './AttentionPanel'

// Tests run at phone width (matchMedia never matches), where a complete dashboard lets the panel collapse.
const completeDashboard = { currentComplete: true, missingCurrencies: [] } as unknown as Dashboard

describe('attention panel', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps a failed check open with its retry instead of claiming all clear', async () => {
    vi.spyOn(api.reports, 'attention').mockRejectedValue(new ApiProblem({ type: 'about:blank', title: 'Service unavailable', status: 503, detail: 'Try again shortly.' }))
    renderWithApp(<AttentionPanel dash={completeDashboard} />)

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible()
    expect(screen.getByText('Check failed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Needs attention' })).not.toBeInTheDocument()
    expect(screen.queryByText('All clear')).not.toBeInTheDocument()
    expect(screen.queryByText('Everything is current')).not.toBeInTheDocument()
  })

  it('shows all clear only after a successful empty check', async () => {
    vi.spyOn(api.reports, 'attention').mockResolvedValue({ items: [] } as unknown as Awaited<ReturnType<typeof api.reports.attention>>)
    renderWithApp(<AttentionPanel dash={completeDashboard} />)

    expect(await screen.findByText('Everything is current')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Needs attention' }))
    expect(screen.getByText('All clear')).toBeInTheDocument()
  })
})
