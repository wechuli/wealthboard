import { useMemo } from 'react'
import type { AIReviewFinding, AIReviewResult } from '@/api/types'
import { DateText, Money } from '@/components/format'
import { FOCUS_OPTIONS, formatTokens, PERIOD_OPTIONS, providerLabel } from './ai-meta'
import { Confidence, SeverityBadge } from './parts'
import { evidenceIndex, evidenceLabel } from './snapshot'

type Index = ReturnType<typeof evidenceIndex>

function FindingList({ title, findings, index, id }: { title: string; findings: AIReviewFinding[]; index: Index; id: string }) {
  if (!findings.length) return null
  return (
    <section aria-labelledby={id} className="py-6 md:py-8">
      <h3 id={id} className="text-md font-semibold text-ink">
        {title}
        <span className="num ml-2 text-sm font-normal text-subtle">{findings.length}</span>
      </h3>
      <ul className="mt-2 divide-y divide-line">
        {findings.map((f) => (
          <li key={f.id} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <h4 className="min-w-0 max-w-[60ch] flex-1 basis-60 font-semibold text-ink">{f.title}</h4>
              <SeverityBadge severity={f.severity} />
            </div>
            <p className="mt-1.5 max-w-[68ch] leading-relaxed text-muted">{f.explanation}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <ul className="flex flex-wrap items-center gap-1.5" aria-label="Evidence">
                {f.evidenceRefs.map((ref) => (
                  <li key={ref}>
                    <span title={ref} className="inline-flex h-6 max-w-[16rem] items-center truncate rounded-full border border-line bg-sunken/60 px-2.5 text-xs text-muted">
                      {evidenceLabel(ref, index)}
                    </span>
                  </li>
                ))}
              </ul>
              <Confidence confidence={f.confidence} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TextList({ title, items, ordered, id }: { title: string; items: string[]; ordered?: boolean; id: string }) {
  if (!items.length) return null
  const List = ordered ? 'ol' : 'ul'
  return (
    <section aria-labelledby={id} className="py-6 md:py-8">
      <h3 id={id} className="text-md font-semibold text-ink">
        {title}
      </h3>
      <List className="mt-3 space-y-3">
        {items.map((item, i) => (
          <li key={`${i}-${item}`} className="flex max-w-[68ch] gap-3 leading-relaxed text-muted">
            <span aria-hidden className="num w-5 shrink-0 text-right text-subtle">
              {ordered ? `${i + 1}.` : '–'}
            </span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </List>
    </section>
  )
}

function snapshotNetWorth(snapshot: AIReviewResult['snapshot']): string | null {
  const totals = (snapshot.portfolio as { totals?: { netWorth?: unknown } }).totals
  return typeof totals?.netWorth === 'string' ? totals.netWorth : null
}

/** The generated review, laid out as a calm editorial document. */
export function ReviewDocument({ result }: { result: AIReviewResult }) {
  const { review, snapshot, provider, usage } = result
  const index = useMemo(() => evidenceIndex(snapshot), [snapshot])
  const exact = (snapshot.sharing as { includeExactAmounts?: boolean }).includeExactAmounts === true
  const netWorth = exact ? snapshotNetWorth(snapshot) : null
  const period = PERIOD_OPTIONS.find((p) => p.value === snapshot.period)?.ariaLabel ?? snapshot.period
  const focus = FOCUS_OPTIONS.find((f) => f.value === snapshot.focus)?.title ?? snapshot.focus
  const empty = !review.dataQuality.length && !review.strengths.length && !review.attentionItems.length && !review.goalObservations.length

  return (
    <article aria-labelledby="review-headline" className="card overflow-hidden">
      <header className="border-b border-line px-5 pb-7 pt-7 md:px-10 md:pb-9 md:pt-10">
        <h2 id="review-headline" className="display max-w-[30ch] text-xl text-ink md:text-2xl">
          {review.headline}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {focus} review · {period} · <DateText value={result.generatedAt} withTime />
        </p>
        <p className="mt-6 max-w-[68ch] text-md leading-relaxed text-ink">{review.executiveSummary}</p>
        {netWorth ? (
          <p className="mt-4 text-sm text-muted">
            Net worth in the snapshot: <Money minor={netWorth} currency={snapshot.baseCurrency} className="font-medium text-ink" />
          </p>
        ) : null}
      </header>

      <div className="divide-y divide-line px-5 md:px-10">
        <FindingList id="review-attention" title="Needs your attention" findings={review.attentionItems} index={index} />
        <FindingList id="review-goals" title="Goal observations" findings={review.goalObservations} index={index} />
        <FindingList id="review-strengths" title="Strengths" findings={review.strengths} index={index} />
        <FindingList id="review-data" title="Data quality" findings={review.dataQuality} index={index} />
        {empty ? <p className="py-6 text-sm text-muted">The model didn’t raise any specific findings for this snapshot.</p> : null}
        <TextList id="review-questions" title="Questions to consider" items={review.questions} ordered />
        <TextList id="review-checks" title="Possible next checks" items={review.possibleNextChecks} />
      </div>

      <footer className="border-t border-line bg-sunken/40 px-5 py-6 text-sm md:px-10">
        <section aria-labelledby="review-limitations">
          <h3 id="review-limitations" className="font-semibold text-ink">
            Limitations
          </h3>
          <ul className="mt-2 max-w-[72ch] list-disc space-y-1 pl-5 text-muted">
            {review.limitations.map((l, i) => (
              <li key={`${i}-${l}`}>{l}</li>
            ))}
          </ul>
        </section>
        <p className="mt-4 max-w-[72ch] text-muted">
          <span className="font-medium text-ink">Not financial advice.</span> This review is explanatory and isn’t regulated financial advice. It isn’t saved: it disappears when you leave or reload this page.
        </p>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
          <div className="flex gap-1.5">
            <dt>Provider</dt>
            <dd className="text-ink">
              {providerLabel(provider.name)} · <span className="font-mono">{provider.model}</span> · {provider.host}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Tokens</dt>
            <dd className="num text-ink">
              {formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out
            </dd>
          </div>
        </dl>
      </footer>
    </article>
  )
}
