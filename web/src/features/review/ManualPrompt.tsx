import { Check, ChevronDown, Copy } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { SelectField, TextareaField } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { cn } from '@/lib/cn'
import { minorExponent } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { accountHistoryAiPrompt, FORMAT_LABELS, investmentHistoryAiPrompt, type AccountHistoryPromptFormat, type InvestmentHistoryPromptFormat } from './ai-prompts'

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * The browser-only alternative to AI conversion: a strict prompt to paste into an AI service the
 * person already trusts. Wealthboard never sends this prompt or any file anywhere.
 */
export function ManualPrompt({ currency, trackingMode }: { currency: string; trackingMode: 'balance' | 'positions' }) {
  const { enabledCurrencies } = usePrefs()
  const [open, setOpen] = useState(false)
  const [historyFormat, setHistoryFormat] = useState<AccountHistoryPromptFormat>('csv')
  const [investmentFormat, setInvestmentFormat] = useState<InvestmentHistoryPromptFormat>('json')
  const [copy, setCopy] = useState<CopyState>('idle')
  const panelId = useId()
  const digits = minorExponent(currency)
  const prompt = useMemo(
    () => (trackingMode === 'positions' ? investmentHistoryAiPrompt(investmentFormat, currency, digits, enabledCurrencies) : accountHistoryAiPrompt(historyFormat, currency, digits)),
    [trackingMode, investmentFormat, historyFormat, currency, digits, enabledCurrencies],
  )
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <section aria-labelledby={`${panelId}-title`} className="rounded-lg border border-line">
      <h3 id={`${panelId}-title`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left hover:bg-sunken/60"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">Prefer your own AI tool?</span>
            <span className="mt-0.5 block text-xs font-normal text-muted">Copy a strict conversion prompt and use it anywhere. Nothing is sent by Wealthboard.</span>
          </span>
          <ChevronDown size={18} aria-hidden className={cn('shrink-0 text-muted transition-transform duration-[var(--dur-2)]', open && 'rotate-180')} />
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="space-y-4 border-t border-line px-4 pb-4 pt-4">
        {open ? (
          <>
            {trackingMode === 'positions' ? (
              <div className="max-w-xs">
                <SelectField
                  label="Output format"
                  value={investmentFormat}
                  onChange={(e) => {
                    setInvestmentFormat(e.target.value as InvestmentHistoryPromptFormat)
                    setCopy('idle')
                  }}
                  options={Object.entries(FORMAT_LABELS).map(([value, label]) => ({ value, label }))}
                />
              </div>
            ) : (
              <div>
                <p aria-hidden className="mb-2 text-sm font-medium text-ink">
                  Output format
                </p>
                <Segmented<AccountHistoryPromptFormat>
                  label="Output format"
                  value={historyFormat}
                  onChange={(v) => {
                    setHistoryFormat(v)
                    setCopy('idle')
                  }}
                  options={[
                    { value: 'csv', label: 'CSV' },
                    { value: 'json', label: 'JSON' },
                  ]}
                />
              </div>
            )}
            <TextareaField label="Conversion prompt" value={prompt} readOnly spellCheck={false} rows={12} className="[&_textarea]:font-mono [&_textarea]:text-xs [&_textarea]:leading-5" onFocus={(e) => e.currentTarget.select()} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 basis-64 text-xs text-muted">
                Paste your statement at the marker. AI-generated files can contain mistakes, so preview the result in Direct import before importing.
              </p>
              <Button icon={copy === 'copied' ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} onClick={() => void onCopy()}>
                {copy === 'copied' ? 'Copied' : 'Copy prompt'}
              </Button>
            </div>
            {copy === 'copied' ? (
              <p role="status" className="text-xs text-positive">
                Prompt copied. Add your source data at the marker before sending it.
              </p>
            ) : copy === 'failed' ? (
              <p role="alert" className="text-xs text-warning">
                The browser couldn’t copy the prompt. Select the text and copy it manually.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  )
}
