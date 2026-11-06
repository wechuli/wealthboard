import { screen, waitFor, within } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import { setScenario } from '@/api/mock/scenario'
import type { ConnectedApp } from '@/api/types'
import ConnectedAppsSettings from '@/features/settings/ConnectedAppsSettings'
import { renderWithApp } from '@/test/render'
import ConsentPage from './ConsentPage'

const { leaveApp } = vi.hoisted(() => ({ leaveApp: vi.fn() }))
vi.mock('@/lib/browser', () => ({ leaveApp }))

const requestId = '11111111-1111-4111-8111-111111111111'

async function settle(client: QueryClient) {
  await waitFor(() => expect(client.getQueryState(['session'])?.status).toBe('success'))
  await waitFor(() => expect(client.isFetching()).toBe(0))
}

afterEach(() => {
  vi.restoreAllMocks()
  leaveApp.mockReset()
})

describe('assistant consent', () => {
  it('names the client and its return host, and approves the chosen data level', async () => {
    setScenario({ data: 'full', auth: 'local' })
    const user = userEvent.setup()
    vi.spyOn(api.oauth, 'request').mockResolvedValue({
      id: requestId,
      clientName: 'Claude',
      redirectHost: 'https://claude.ai',
      scopes: ['portfolio:read'],
      expiresAt: '2026-11-06T18:10:00Z',
    })
    const approve = vi.spyOn(api.oauth, 'approve').mockResolvedValue({ redirectTo: 'https://claude.ai/api/mcp/auth_callback?code=c&state=s' })
    const deny = vi.spyOn(api.oauth, 'deny')
    const r = renderWithApp(<ConsentPage />, { route: `/oauth/consent?request=${requestId}` })
    await settle(r.client)

    expect(await screen.findByRole('heading', { level: 1, name: 'Connect Claude?' })).toBeInTheDocument()
    expect(screen.getAllByText(/https:\/\/claude\.ai/).length).toBeGreaterThan(0)
    expect(screen.getByText('Only continue if you started this')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Detailed/ })).toBeChecked()
    expect(screen.queryByRole('switch', { name: 'Allow changes' })).not.toBeInTheDocument()
    expect(screen.getByText(/Read-only: it can't record/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Summary only/ }))
    await user.click(screen.getByRole('button', { name: 'Allow access' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith(requestId, 'summary', false))
    await waitFor(() => expect(leaveApp).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=c&state=s'))
    expect(deny).not.toHaveBeenCalled()
  })

  it('offers changes, off by default, only with detailed access when the client asks for them', async () => {
    setScenario({ data: 'full', auth: 'local' })
    const user = userEvent.setup()
    vi.spyOn(api.oauth, 'request').mockResolvedValue({
      id: requestId,
      clientName: 'Claude',
      redirectHost: 'https://claude.ai',
      scopes: ['portfolio:read', 'portfolio:write'],
      expiresAt: '2026-11-06T18:10:00Z',
    })
    const approve = vi.spyOn(api.oauth, 'approve').mockResolvedValue({ redirectTo: 'https://claude.ai/cb?code=c' })
    const r = renderWithApp(<ConsentPage />, { route: `/oauth/consent?request=${requestId}` })
    await settle(r.client)

    expect(await screen.findByText(/asking to read and add to your Wealthboard data/)).toBeInTheDocument()
    const changes = screen.getByRole('switch', { name: 'Allow changes' })
    expect(changes).not.toBeChecked()
    await user.click(changes)
    expect(changes).toBeChecked()
    expect(screen.getByText(/Adds only: it can record transactions and valuations/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Summary only/ }))
    expect(changes).toBeDisabled()
    expect(changes).not.toBeChecked()
    expect(screen.getByText('Changes need detailed access.')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Detailed/ }))
    expect(changes).not.toBeChecked()
    await user.click(changes)
    await user.click(screen.getByRole('button', { name: 'Allow access' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith(requestId, 'detailed', true))
  })

  it('declines and returns to the client', async () => {
    setScenario({ data: 'full', auth: 'local' })
    const user = userEvent.setup()
    vi.spyOn(api.oauth, 'request').mockResolvedValue({ id: requestId, clientName: 'ChatGPT', redirectHost: 'https://chatgpt.com', scopes: ['portfolio:read'], expiresAt: '2026-11-06T18:10:00Z' })
    const approve = vi.spyOn(api.oauth, 'approve')
    vi.spyOn(api.oauth, 'deny').mockResolvedValue({ redirectTo: 'https://chatgpt.com/cb?error=access_denied' })
    const r = renderWithApp(<ConsentPage />, { route: `/oauth/consent?request=${requestId}` })
    await settle(r.client)

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(leaveApp).toHaveBeenCalledWith('https://chatgpt.com/cb?error=access_denied'))
    expect(approve).not.toHaveBeenCalled()
  })

  it('explains an expired or missing request without offering approval', async () => {
    setScenario({ data: 'full', auth: 'local' })
    vi.spyOn(api.oauth, 'request').mockRejectedValue(new ApiProblem({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'gone' }))
    const r = renderWithApp(<ConsentPage />, { route: `/oauth/consent?request=${requestId}` })
    await settle(r.client)
    expect(await screen.findByRole('heading', { name: 'This connection request has expired' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Allow access' })).not.toBeInTheDocument()

    r.unmount()
    renderWithApp(<ConsentPage />, { route: '/oauth/consent' })
    expect(await screen.findByRole('heading', { name: 'This connection request has expired' })).toBeInTheDocument()
  })
})

describe('connected apps settings', () => {
  const app: ConnectedApp = {
    id: '22222222-2222-4222-8222-222222222222',
    clientName: 'Claude',
    redirectHost: 'https://claude.ai',
    scopes: ['portfolio:read'],
    dataLevel: 'detailed',
    createdAt: '2026-11-01T09:00:00Z',
    lastUsedAt: '2026-11-06T08:00:00Z',
    recentCalls: [
      { tool: 'get_account', outcome: 'error', at: '2026-11-06T08:00:00Z' },
      { tool: 'get_portfolio_summary', outcome: 'success', at: '2026-11-06T07:59:00Z' },
    ],
  }

  it('lists connections with their activity and confirms before disconnecting', async () => {
    setScenario({ data: 'full', auth: 'local' })
    const user = userEvent.setup()
    vi.spyOn(api.connectedApps, 'list').mockResolvedValue([app])
    const revoke = vi.spyOn(api.connectedApps, 'revoke').mockResolvedValue()
    const clear = vi.spyOn(api.connectedApps, 'clearCalls').mockResolvedValue()
    const r = renderWithApp(<ConnectedAppsSettings />, { route: '/settings/connected-apps' })
    await settle(r.client)

    expect(await screen.findByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('Returns to https://claude.ai')).toBeInTheDocument()
    expect(screen.queryByText('Can make changes', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText(`${window.location.origin}/mcp`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Recent activity/ }))
    const activity = screen.getByRole('list', { name: 'Recent activity for Claude' })
    expect(within(activity).getByText('Portfolio summary')).toBeInTheDocument()
    expect(within(activity).getByText('Failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear history' }))
    await waitFor(() => expect(clear).toHaveBeenCalledWith(app.id))

    await user.click(screen.getByRole('button', { name: 'Disconnect Claude' }))
    const confirm = await screen.findByRole('dialog', { name: 'Disconnect Claude?' })
    expect(revoke).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(app.id))
  })

  it('marks a connection that can make changes and labels its write activity', async () => {
    setScenario({ data: 'full', auth: 'local' })
    const user = userEvent.setup()
    vi.spyOn(api.connectedApps, 'list').mockResolvedValue([
      { ...app, scopes: ['portfolio:read', 'portfolio:write'], recentCalls: [{ tool: 'record_transaction', outcome: 'success', at: '2026-11-06T08:00:00Z' }] },
    ])
    const r = renderWithApp(<ConnectedAppsSettings />, { route: '/settings/connected-apps' })
    await settle(r.client)
    expect(await screen.findByText('Can make changes', { exact: true })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Recent activity/ }))
    expect(within(screen.getByRole('list', { name: 'Recent activity for Claude' })).getByText('Recorded a transaction')).toBeInTheDocument()
  })

  it('explains how to connect when nothing is connected', async () => {
    setScenario({ data: 'full', auth: 'local' })
    const r = renderWithApp(<ConnectedAppsSettings />, { route: '/settings/connected-apps' })
    await settle(r.client)
    expect(await screen.findByText('No connected apps')).toBeInTheDocument()
    expect(screen.getByText(/custom connector in Claude or ChatGPT/)).toBeInTheDocument()
  })
})
