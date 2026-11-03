import { screen, waitFor, within } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { setScenario } from '@/api/mock/scenario'
import { renderWithApp } from '@/test/render'
import ApiKeysSettings from './ApiKeysSettings'
import InstrumentSettings from './InstrumentSettings'
import SecuritySettings from './SecuritySettings'

async function settle(client: QueryClient) {
  await waitFor(() => expect(client.getQueryState(['session'])?.status).toBe('success'))
  await waitFor(() => expect(client.isFetching()).toBe(0))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('API keys', () => {
  it('shows a new key once, then confirms before revoking it', async () => {
    setScenario({ data: 'full', auth: 'local' })
    const user = userEvent.setup()
    const create = vi.spyOn(api.apiKeys, 'create')
    const revoke = vi.spyOn(api.apiKeys, 'revoke')
    const r = renderWithApp(<ApiKeysSettings />, { route: '/settings/api-keys' })
    await settle(r.client)

    await user.type(await screen.findByLabelText('Name'), 'Home dashboard key')
    await user.click(screen.getByRole('checkbox', { name: /Download exports/ }))
    await user.click(screen.getByRole('button', { name: 'Create API key' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({ name: 'Home dashboard key', scopes: ['portfolio:read', 'exports:read'], expiresAt: null })

    const dialog = await screen.findByRole('dialog', { name: 'Copy your new API key' })
    expect(within(dialog).getByText('You won’t see this key again')).toBeInTheDocument()
    const token = (within(dialog).getByLabelText('New API key') as HTMLInputElement).value
    expect(token.length).toBeGreaterThan(12)
    await user.click(within(dialog).getByRole('button', { name: 'I’ve saved it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // The full token is gone for good; only the prefix remains in the list.
    expect(screen.queryByDisplayValue(token)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(token)

    const [revokeButton] = await screen.findAllByRole('button', { name: 'Revoke Home dashboard key' })
    await user.click(revokeButton!)
    const confirm = await screen.findByRole('dialog', { name: 'Revoke “Home dashboard key”?' })
    expect(revoke).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Revoke key' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryAllByRole('button', { name: 'Revoke Home dashboard key' })).toHaveLength(0))
  })

  it('requires at least one scope', async () => {
    setScenario({ data: 'full', auth: 'local' })
    const user = userEvent.setup()
    const create = vi.spyOn(api.apiKeys, 'create')
    const r = renderWithApp(<ApiKeysSettings />, { route: '/settings/api-keys' })
    await settle(r.client)
    await user.type(await screen.findByLabelText('Name'), 'No scopes')
    await user.click(screen.getByRole('checkbox', { name: /Read portfolio data/ }))
    await user.click(screen.getByRole('button', { name: 'Create API key' }))
    expect(await screen.findByText('Choose at least one scope')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('security: provider results', () => {
  it('explains an ?auth= result code and removes the parameter', async () => {
    setScenario({ data: 'full', auth: 'both' })
    const r = renderWithApp(<SecuritySettings />, { route: '/settings/security?auth=access_denied' })
    await settle(r.client)
    expect(await screen.findByText('That Home SSO identity can’t be used here')).toBeInTheDocument()
    expect(screen.getByText(/Your sign-in methods were not changed/)).toBeInTheDocument()
    await waitFor(() => expect(r.router.state.location.search).toBe(''))
  })

  it('offers to link the provider with the current password and shows server problems', async () => {
    setScenario({ data: 'full', auth: 'both' })
    const user = userEvent.setup()
    const r = renderWithApp(<SecuritySettings />, { route: '/settings/security' })
    await settle(r.client)
    expect(await screen.findByRole('heading', { name: 'Sign-in methods' })).toBeInTheDocument()
    expect(screen.getByText('Not linked')).toBeInTheDocument()
    const link = screen.getByRole('button', { name: 'Continue to Home SSO' })
    const form = link.closest('form')!
    await user.type(within(form).getByLabelText('Current password'), 'wealthboard-demo')
    await user.click(link)
    expect(await screen.findByText('Not available in the mock')).toBeInTheDocument()
  })
})

describe('instrument deep links', () => {
  it('opens the add sheet from ?new=1 and removes the parameter on close', async () => {
    setScenario({ data: 'full', auth: 'local' })
    const user = userEvent.setup()
    const r = renderWithApp(<InstrumentSettings />, { route: '/settings/instruments?new=1' })
    await settle(r.client)
    const sheet = await screen.findByRole('dialog', { name: 'New instrument' })
    expect(within(sheet).getByRole('button', { name: 'Add instrument' })).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(r.router.state.location.search).toBe('')
  })

  it('opens the edit sheet from ?edit=<id>', async () => {
    setScenario({ data: 'full', auth: 'local' })
    const instruments = await api.instruments.list()
    const target = instruments.find((i) => !i.archivedAt)!
    const r = renderWithApp(<InstrumentSettings />, { route: `/settings/instruments?edit=${target.id}` })
    await settle(r.client)
    const sheet = await screen.findByRole('dialog', { name: `Edit ${target.symbol ?? target.name}` })
    expect(within(sheet).getByLabelText('Name')).toHaveValue(target.name)
  })
})
