import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setScenario } from '@/api/mock/scenario'
import { renderWithApp } from '@/test/render'
import SignInPage from './SignInPage'
import { normalizeOidcCode, signInOidcMessage } from './oidc-messages'

describe('sign-in provider errors', () => {
  it('shows the message for ?oidc_error= and removes the parameter', async () => {
    setScenario({ data: 'full', auth: 'both' })
    const r = renderWithApp(<SignInPage />, { route: '/sign-in?oidc_error=rate_limited&next=%2Fgoals' })
    expect(await screen.findByText('Too many sign-in requests')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Wait a few minutes, then try again.')
    await waitFor(() => expect(r.router.state.location.search).toBe('?next=%2Fgoals'))
    expect(await screen.findByRole('button', { name: 'Continue with Home SSO' })).toBeInTheDocument()
  })

  it('names the provider and covers every server code', () => {
    expect(signInOidcMessage('unavailable', 'Home SSO').title).toBe('Home SSO sign-in is temporarily unavailable')
    expect(signInOidcMessage('provider_error', 'Home SSO').title).toBe('Home SSO sign-in was cancelled or rejected')
    expect(signInOidcMessage('access_denied', 'Home SSO').title).toBe('Sign-in is not available for this account')
    expect(signInOidcMessage('invalid_callback', 'Home SSO').title).toBe('The response from Home SSO couldn’t be verified')
    expect(normalizeOidcCode('provider')).toBe('provider_error')
    expect(normalizeOidcCode('something-new')).toBe('invalid_callback')
  })
})
