import type { AIProviderSettings } from '@/api/types'
import { aiProviderOption, isAIProvider } from '@/lib/ai-providers'

/**
 * Consent-bound fingerprint for import conversion. Must match the server's
 * `configurationHash`: SHA-256 of the JSON array below, with `updatedAt` exactly as the API returns it.
 */
export async function configurationHash(
  settings: Pick<AIProviderSettings, 'provider' | 'baseUrl' | 'model' | 'maxOutputTokens' | 'updatedAt'>,
  trackingMode: 'balance' | 'positions',
  currency: string,
): Promise<string> {
  const value = JSON.stringify([settings.provider, settings.baseUrl, settings.model, settings.maxOutputTokens, settings.updatedAt, trackingMode, currency])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function providerLabel(provider: string): string {
  return isAIProvider(provider) ? aiProviderOption(provider).label : provider
}

export function endpointHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

const tokenFormat = new Intl.NumberFormat('en-US')
export const formatTokens = (n: number | null | undefined) => (n === null || n === undefined ? '—' : tokenFormat.format(n))

export const REQUEST_TYPE_LABELS: Record<string, string> = {
  // Usage from the retired in-app review stays visible until the 90-day pruning removes it.
  portfolio_review: 'Portfolio review',
  import_conversion: 'Import conversion',
}

export const USAGE_STATUS: Record<string, { label: string; tone: 'positive' | 'negative' | 'warning' | 'neutral' }> = {
  success: { label: 'Succeeded', tone: 'positive' },
  error: { label: 'Failed', tone: 'negative' },
  rate_limited: { label: 'Rate limited', tone: 'warning' },
  budget_exceeded: { label: 'Over budget', tone: 'warning' },
  started: { label: 'In progress', tone: 'neutral' },
}

export const ERROR_CODE_LABELS: Record<string, string> = {
  cooldown: 'Too many requests in a minute',
  provider_timeout: 'Provider timed out',
  provider_credential: 'Provider rejected the API key',
  provider_model: 'Provider doesn’t serve this model',
  provider_rate_limited: 'Provider rate limit',
  invalid_output: 'Response failed validation',
  provider_unavailable: 'Provider unavailable',
  monthly_token_limit: 'Monthly token limit reached',
}
