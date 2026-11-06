import { screen, waitFor, within } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { setScenario } from '@/api/mock/scenario'
import type { Account, AIRead } from '@/api/types'
import { AiConvert } from '@/features/imports/AiConvert'
import AiSettings from '@/features/settings/AiSettings'
import { renderWithApp } from '@/test/render'

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
    monthlyTokenLimit: 100_000,
    maxOutputTokens: 1_200,
    createdAt: '2026-09-20T10:00:00Z',
    updatedAt: '2026-09-20T10:00:00.5Z',
  },
  usage: { billingMonth: '2026-09', chargedTokens: 0, remainingTokens: 100_000, monthlyTokenLimit: 100_000, successfulRequests: 0, lastUsedAt: null },
  events: [],
  availability: {
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
      usage: { ...configured.usage, chargedTokens: 4_200, remainingTokens: 95_800, successfulRequests: 2, lastUsedAt: '2026-09-21T08:00:00Z' },
      events: [
        {
          id: '00000000-0000-4000-8000-000000000010',
          provider: 'openai',
          endpointHost: 'api.openai.com',
          model: 'gpt-5.5',
          requestType: 'import_conversion',
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
    expect(screen.getAllByText('Import conversion').length).toBeGreaterThan(0)
    expect(screen.queryByText('Include exact amounts')).not.toBeInTheDocument()
    expect(screen.getByText('95,800')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect OpenAI?' })
    expect(disconnect).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1))
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
