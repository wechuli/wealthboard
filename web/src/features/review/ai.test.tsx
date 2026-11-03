import { screen, waitFor, within } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { setScenario } from '@/api/mock/scenario'
import type { Account, AIRead, AIReviewRequest, AIReviewResult } from '@/api/types'
import { PRIVACY_STORAGE_KEY } from '@/config'
import { AiConvert } from '@/features/imports/AiConvert'
import AiSettings from '@/features/settings/AiSettings'
import { renderWithApp } from '@/test/render'
import ReviewPage from './ReviewPage'

const { extractSource } = vi.hoisted(() => ({ extractSource: vi.fn() }))
vi.mock('@/lib/source-extraction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/source-extraction')>()),
  extractSource,
}))

const configured: AIRead = {
  settings: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    hasStoredApiKey: true,
    apiKeyHint: '...1234',
    includeExactAmounts: false,
    includeAccountNames: false,
    monthlyTokenLimit: 100_000,
    maxOutputTokens: 1_200,
    createdAt: '2026-09-20T10:00:00Z',
    updatedAt: '2026-09-20T10:00:00.5Z',
  },
  usage: { billingMonth: '2026-09', chargedTokens: 0, remainingTokens: 100_000, monthlyTokenLimit: 100_000, successfulReviews: 0, lastUsedAt: null },
  events: [],
  reviewAvailability: {
    available: true,
    reason: 'available',
    providerConfigured: true,
    storedCredentialAvailable: true,
    sessionCredentialAccepted: true,
    cooldownUntil: null,
    budgetRemainingTokens: 100_000,
  },
}

const account = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Equity Bank Savings',
  currency: 'KES',
  trackingMode: 'balance',
  isLiability: false,
} as Account

async function settle(client: QueryClient) {
  await waitFor(() => expect(client.isFetching()).toBe(0))
  await waitFor(() => expect(client.isFetching()).toBe(0))
}

beforeEach(() => {
  setScenario({ data: 'full' })
  extractSource.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  // Sonner keeps toasts in module state; clear them so one test's toast can't leak into the next.
  toast.dismiss()
})

describe('AI provider settings', () => {
  it('validates the model and keeps maximum output tokens within the monthly limit', async () => {
    const user = userEvent.setup()
    const save = vi.spyOn(api.ai, 'saveSettings')
    const r = renderWithApp(<AiSettings />, { route: '/settings/ai' })
    await settle(r.client)

    expect(await screen.findByRole('heading', { level: 2, name: 'AI provider' })).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.getByText('https://api.openai.com/v1')).toBeInTheDocument()

    const model = screen.getByLabelText('Model')
    await user.clear(model)
    await user.type(model, 'gpt 5 preview')
    const limit = screen.getByLabelText('Monthly token limit')
    await user.clear(limit)
    await user.type(limit, '20,000')
    const output = screen.getByLabelText('Maximum output tokens')
    await user.clear(output)
    await user.type(output, '30000')
    await user.click(screen.getByRole('button', { name: 'Connect provider' }))

    expect(await screen.findByText(/Use the provider’s model ID/)).toBeInTheDocument()
    expect(screen.getByText('Keep this at or below the monthly limit (20,000)')).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()

    // Switching provider replaces a non-suggested value only when it was a suggestion: here it's custom, so it stays.
    await user.click(screen.getByRole('radio', { name: /Anthropic/ }))
    expect(model).toHaveValue('gpt 5 preview')
    expect(screen.getByText('https://api.anthropic.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'claude-sonnet-5' }))
    expect(model).toHaveValue('claude-sonnet-5')
    await user.clear(output)
    await user.type(output, '2000')
    await user.click(screen.getByRole('button', { name: 'Connect provider' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]?.[0]).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      includeExactAmounts: false,
      includeAccountNames: false,
      monthlyTokenLimit: 20_000,
      maxOutputTokens: 2_000,
    })
    // The mock has no AI backend: its 501 problem is shown as a notice.
    expect(await screen.findByText('Not available in the mock')).toBeInTheDocument()
    expect(screen.getByText(/needs the real server/)).toBeInTheDocument()
  })

  it('shows the stored key hint, usage, and confirms before disconnecting', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.ai, 'get').mockResolvedValue({
      ...configured,
      usage: { ...configured.usage, chargedTokens: 4_200, remainingTokens: 95_800, successfulReviews: 2, lastUsedAt: '2026-09-21T08:00:00Z' },
      events: [
        {
          id: '00000000-0000-4000-8000-000000000010',
          provider: 'openai',
          endpointHost: 'api.openai.com',
          model: 'gpt-5.5',
          requestType: 'portfolio_review',
          status: 'success',
          billingMonth: '2026-09',
          chargedTokens: 4_200,
          inputTokens: 3_000,
          outputTokens: 1_200,
          latencyMs: 8_400,
          errorCode: null,
          createdAt: '2026-09-21T08:00:00Z',
          updatedAt: '2026-09-21T08:00:08Z',
        },
      ],
    })
    const disconnect = vi.spyOn(api.ai, 'disconnect')
    const r = renderWithApp(<AiSettings />, { route: '/settings/ai' })
    await settle(r.client)

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('1234')).toBeInTheDocument()
    expect(screen.queryByLabelText('API key', { selector: 'input' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Portfolio review').length).toBeGreaterThan(0)
    expect(screen.getByText('95,800')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect OpenAI?' })
    expect(disconnect).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1))
  })
})

describe('portfolio review', () => {
  it('explains how to connect a provider when none is configured', async () => {
    const r = renderWithApp(<ReviewPage />, { route: '/review' })
    await settle(r.client)
    expect(await screen.findByRole('heading', { level: 1, name: 'Portfolio review' })).toBeInTheDocument()
    expect(screen.getByRole('note', { name: 'Not financial advice' })).toBeInTheDocument()
    expect(screen.getByText('Connect an AI provider to request a review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up AI provider' })).toHaveAttribute('href', '/settings/ai')
    expect(screen.queryByRole('button', { name: 'Generate review' })).not.toBeInTheDocument()
  })

  it('blocks generation when the monthly budget is used up', async () => {
    vi.spyOn(api.ai, 'get').mockResolvedValue({
      ...configured,
      usage: { ...configured.usage, chargedTokens: 100_000, remainingTokens: 0 },
      reviewAvailability: { ...configured.reviewAvailability, available: false, reason: 'monthly_token_limit_reached', budgetRemainingTokens: 0 },
    })
    const r = renderWithApp(<ReviewPage />, { route: '/review' })
    await settle(r.client)
    expect(await screen.findByText('This month’s token budget is used up')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate review' })).toBeDisabled()
  })

  it('requires a session key when none is stored and renders the mock 501 as a notice', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.ai, 'get').mockResolvedValue({
      ...configured,
      settings: { ...configured.settings!, hasStoredApiKey: false, apiKeyHint: null },
      reviewAvailability: { ...configured.reviewAvailability, reason: 'session_credential_required', storedCredentialAvailable: false },
    })
    const review = vi.spyOn(api.ai, 'review')
    const r = renderWithApp(<ReviewPage />, { route: '/review' })
    await settle(r.client)

    const generate = await screen.findByRole('button', { name: 'Generate review' })
    expect(generate).toBeDisabled()
    await user.type(screen.getByLabelText(/Session-only API key/), 'sk-fictional-0001')
    expect(generate).toBeEnabled()
    await user.click(generate)

    expect(await screen.findByText('Not available in the mock')).toBeInTheDocument()
    expect(review).toHaveBeenCalledTimes(1)
    const body = review.mock.calls[0]![0]
    expect(body).toMatchObject({ period: expect.any(String), focus: 'overall', includeExactAmounts: false, includeAccountNames: false, apiKey: 'sk-fictional-0001' })
    // Private defaults: pseudonymous accounts and goals, and no amounts anywhere in the snapshot.
    const snapshot = JSON.stringify(body.snapshot)
    expect(snapshot).toContain('"alias":"Account 1"')
    expect(snapshot).not.toMatch(/Minor"?:/)
    expect(snapshot).not.toContain('Equity Bank')
  })
})

function fakeReview(body: AIReviewRequest): AIReviewResult {
  return {
    review: {
      schemaVersion: 1,
      headline: 'Concentrated in fixed income, with one goal behind',
      executiveSummary: 'Most of the portfolio sits in two categories.',
      dataQuality: [],
      strengths: [],
      attentionItems: [
        { id: 'a1', category: 'allocation', severity: 'attention', confidence: 'medium', title: 'Heavy weighting in one category', explanation: 'One category holds the largest share.', evidenceRefs: ['category-1', 'account-1'] },
      ],
      goalObservations: [{ id: 'g1', category: 'goals', severity: 'high', confidence: 'high', title: 'A goal is behind plan', explanation: 'Progress trails the plan.', evidenceRefs: ['goal-1'] }],
      questions: ['Is the current mix intentional?'],
      possibleNextChecks: ['Are all exchange rates current?'],
      limitations: ['Based on a pseudonymous snapshot without amounts.'],
    },
    snapshot: body.snapshot,
    provider: { name: 'openai', host: 'api.openai.com', model: 'gpt-5.5' },
    usage: { inputTokens: 1800, outputTokens: 640 },
    generatedAt: '2026-09-21T08:00:00Z',
  } as AIReviewResult
}

describe('review document', () => {
  it('renders the review as a document with severity, confidence, and evidence', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.ai, 'get').mockResolvedValue(configured)
    vi.spyOn(api.ai, 'review').mockImplementation(async (body) => fakeReview(body))
    const r = renderWithApp(<ReviewPage />, { route: '/review' })
    await settle(r.client)
    await user.click(await screen.findByRole('button', { name: 'Generate review' }))

    const doc = await screen.findByRole('article', { name: 'Concentrated in fixed income, with one goal behind' })
    expect(within(doc).getByRole('heading', { name: /Needs your attention/ })).toBeInTheDocument()
    expect(within(doc).getByText('Needs attention')).toBeInTheDocument()
    expect(within(doc).getByText('Medium confidence')).toBeInTheDocument()
    expect(within(doc).getByText('Account 1')).toBeInTheDocument()
    expect(within(doc).getByText(/Goal 1 · .*% complete/)).toBeInTheDocument()
    expect(within(doc).getByText('Is the current mix intentional?')).toBeInTheDocument()
    expect(within(doc).getByText('Based on a pseudonymous snapshot without amounts.')).toBeInTheDocument()
    expect(within(doc).getByText(/1,800 in · 640 out/)).toBeInTheDocument()
  })

  it('keeps the review out of view while values are hidden', async () => {
    localStorage.setItem(PRIVACY_STORAGE_KEY, 'true')
    const user = userEvent.setup()
    vi.spyOn(api.ai, 'get').mockResolvedValue(configured)
    vi.spyOn(api.ai, 'review').mockImplementation(async (body) => fakeReview(body))
    const r = renderWithApp(<ReviewPage />, { route: '/review' })
    await settle(r.client)
    await user.click(await screen.findByRole('button', { name: 'Generate review' }))
    expect(await screen.findByRole('heading', { name: 'Review hidden' })).toBeInTheDocument()
    expect(screen.queryByText('Concentrated in fixed income, with one goal behind')).not.toBeInTheDocument()
  })
})

describe('AI-assisted import', () => {
  it('needs explicit consent, resets it on edits, and shows the mock 501 as a notice', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.ai, 'get').mockResolvedValue(configured)
    const convert = vi.spyOn(api.ai, 'convertImport')
    extractSource.mockResolvedValue({
      units: [
        { id: 'source-1', location: 'Page 1', text: 'Account 0011223344; Deposit 12,300.00' },
        { id: 'source-2', location: 'Page 2', text: 'Closing balance footer' },
      ],
      warnings: ['PDF text order may differ from the printed page.'],
    })
    const r = renderWithApp(<AiConvert account={account} />, { route: '/accounts/x/import?tab=ai' })
    await settle(r.client)

    const file = new File(['%PDF-'], 'statement.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Source file'), file)
    await user.type(screen.getByLabelText(/PDF password/), 'fictional-password')
    await user.click(screen.getByRole('button', { name: 'Read file' }))
    expect(extractSource).toHaveBeenCalledWith(file, 'fictional-password', { signal: expect.any(AbortSignal) })

    expect(await screen.findByText('PDF text order may differ from the printed page.')).toBeInTheDocument()
    const send = screen.getByRole('button', { name: 'Convert selected text' })
    expect(send).toBeDisabled()
    const consent = screen.getByRole('checkbox', { name: /I approve sending the selected text/ })
    await user.click(consent)
    expect(send).toBeEnabled()

    // Redacting text clears consent; it has to be given again.
    const text = screen.getByLabelText('Text to send for source-1')
    await user.clear(text)
    await user.type(text, 'Deposit 12,300.00')
    expect(consent).not.toBeChecked()
    expect(send).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Page 2/ }))
    await user.click(consent)
    await user.click(send)

    expect(await screen.findByText('Not available in the mock')).toBeInTheDocument()
    expect(convert).toHaveBeenCalledTimes(1)
    const body = convert.mock.calls[0]![0]
    expect(body).toMatchObject({ consent: true, trackingMode: 'balance', currency: 'KES' })
    expect(body.configurationHash).toMatch(/^[a-f0-9]{64}$/)
    expect(body.source.units).toEqual([{ id: 'source-1', location: 'Page 1', text: 'Deposit 12,300.00' }])
    expect(JSON.stringify(body)).not.toMatch(/fictional-password|0011223344|statement\.pdf/)
    expect(body).not.toHaveProperty('apiKey')
    expect(consent).not.toBeChecked()
  })

  it('points to AI settings when no provider is connected', async () => {
    const r = renderWithApp(<AiConvert account={account} />, { route: '/accounts/x/import?tab=ai' })
    await settle(r.client)
    expect(await screen.findByText('Connect an AI provider to convert statements')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up AI provider' })).toHaveAttribute('href', '/settings/ai')
    expect(screen.getByRole('button', { name: /Prefer your own AI tool/ })).toBeInTheDocument()
  })
})
