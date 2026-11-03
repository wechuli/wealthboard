import { focusManager } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import { useSignOut } from '@/features/shell/useSignOut'
import { renderWithApp } from '@/test/render'
import { useSession } from './session'

function Probe() {
  const { status, user } = useSession()
  const signOut = useSignOut()
  return (
    <>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user?.id ?? 'none'}</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </>
  )
}

const unauthorized = () => new ApiProblem({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Sign in again.' })

async function signedIn() {
  const r = renderWithApp(<Probe />, { route: '/accounts' })
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'))
  const userId = screen.getByTestId('user').textContent ?? ''
  r.client.setQueryData(['u', userId, 'accounts'], ['cached private data'])
  return { ...r, userId }
}

describe('session revalidation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('re-checks the session after a 401 and drops the cached data when it has ended', async () => {
    const { client, userId } = await signedIn()
    const session = vi.spyOn(api.auth, 'session').mockResolvedValue(null)

    await client.fetchQuery({ queryKey: ['u', userId, 'goals'], queryFn: () => Promise.reject(unauthorized()) }).catch(() => {})

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'))
    expect(session).toHaveBeenCalled()
    expect(client.getQueryData(['u', userId, 'accounts'])).toBeUndefined()
  })

  it('re-checks the session when the window regains focus', async () => {
    await signedIn()
    const session = vi.spyOn(api.auth, 'session').mockResolvedValue(null)
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'))
    expect(session).toHaveBeenCalled()
    focusManager.setFocused(undefined)
  })

  it.skipIf(typeof BroadcastChannel !== 'function')('re-checks the session when another tab signs out', async () => {
    await signedIn()
    vi.spyOn(api.auth, 'session').mockResolvedValue(null)
    const otherTab = new BroadcastChannel('wealthboard-session')
    otherTab.postMessage('changed')
    otherTab.close()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'))
  })

  it('keeps the last known session when a background re-check cannot reach the server', async () => {
    const { client } = await signedIn()
    vi.spyOn(api.auth, 'session').mockRejectedValue(new ApiProblem({ type: 'about:blank', title: 'Offline', status: 0, detail: 'Offline' }))
    await client.refetchQueries({ queryKey: ['session'] }).catch(() => {})
    await waitFor(() => expect(client.getQueryState(['session'])?.status).toBe('error'))
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in')
  })
})

describe('sign out', () => {
  afterEach(() => vi.restoreAllMocks())

  it('stays signed in and says so when the server cannot confirm the logout', async () => {
    const { client, router, userId } = await signedIn()
    vi.spyOn(api.auth, 'logout').mockRejectedValue(new ApiProblem({ type: 'about:blank', title: 'Offline', status: 0, detail: 'The server could not be reached. Check your connection.' }))

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('Couldn’t sign out')).toBeInTheDocument()
    expect(screen.getByText(/You’re still signed in on this device/)).toBeInTheDocument()
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in')
    expect(router.state.location.pathname).toBe('/accounts')
    expect(client.getQueryData(['u', userId, 'accounts'])).toEqual(['cached private data'])
  })

  it('treats an already-expired session as signed out', async () => {
    const { client, router, userId } = await signedIn()
    vi.spyOn(api.auth, 'logout').mockRejectedValue(unauthorized())

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(screen.getByTestId('status')).toHaveTextContent('signed-out')
    expect(client.getQueryData(['u', userId, 'accounts'])).toBeUndefined()
  })
})
