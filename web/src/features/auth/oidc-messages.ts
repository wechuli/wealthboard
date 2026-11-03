/**
 * Friendly copy for the result codes the server appends when a provider round trip fails:
 * `/login?oidc_error=<code>` for sign-in and `/settings?auth=<code>` for linking and re-verification
 * (see internal/api/oidc.go). Unknown codes fall back to the "couldn't be verified" message.
 */

export type OidcErrorCode = 'unavailable' | 'provider_error' | 'invalid_callback' | 'access_denied' | 'rate_limited'

const ALIASES: Record<string, OidcErrorCode> = {
  unavailable: 'unavailable',
  provider: 'provider_error',
  provider_error: 'provider_error',
  invalid_callback: 'invalid_callback',
  access_denied: 'access_denied',
  rate_limited: 'rate_limited',
}

export function normalizeOidcCode(code: string): OidcErrorCode {
  return ALIASES[code] ?? 'invalid_callback'
}

const providerLabel = (name: string | undefined) => (name?.trim() ? name.trim() : 'Your identity provider')

/** Sign-in failures (`?oidc_error=`). Never reveals whether a profile exists. */
export function signInOidcMessage(code: string, providerName?: string): { title: string; body: string } {
  const p = providerLabel(providerName)
  switch (normalizeOidcCode(code)) {
    case 'unavailable':
      return { title: `${p} sign-in is temporarily unavailable`, body: 'Try again later. If it keeps happening, ask whoever runs this server to check the provider settings.' }
    case 'provider_error':
      return { title: `${p} sign-in was cancelled or rejected`, body: 'Nothing was changed. Start again when you’re ready.' }
    case 'access_denied':
      return { title: 'Sign-in is not available for this account', body: `${p} confirmed who you are, but that identity can’t sign in to this server.` }
    case 'rate_limited':
      return { title: 'Too many sign-in requests', body: 'Wait a few minutes, then try again.' }
    case 'invalid_callback':
    default:
      return { title: `The response from ${p} couldn’t be verified`, body: 'This can happen if the sign-in took too long or was opened in another tab. Try again.' }
  }
}

/** Linking and re-verification failures (`/settings?auth=`). */
export function settingsOidcMessage(code: string, providerName?: string): { title: string; body: string } {
  const p = providerLabel(providerName)
  switch (normalizeOidcCode(code)) {
    case 'unavailable':
      return { title: `${p} is temporarily unavailable`, body: 'Nothing was changed. Try again in a few minutes.' }
    case 'provider_error':
      return { title: `${p} cancelled or rejected the request`, body: 'Nothing was changed. Start again when you’re ready.' }
    case 'access_denied':
      return {
        title: `That ${p} identity can’t be used here`,
        body: 'It may already be linked to another profile, or it doesn’t match the identity linked to this one. Your sign-in methods were not changed.',
      }
    case 'rate_limited':
      return { title: 'Too many verification requests', body: 'Nothing was changed. Wait a few minutes, then try again.' }
    case 'invalid_callback':
    default:
      return { title: `The response from ${p} couldn’t be verified`, body: 'Nothing was changed. This can happen if verification took too long or was opened in another tab. Try again.' }
  }
}
