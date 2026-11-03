import { ArrowRight, Check, Pencil, ScrollText } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { DateText } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { cn } from '@/lib/cn'
import { usePrefs } from '@/lib/prefs'
import { usePageTitle } from '@/lib/usePageTitle'
import { EstateSkeleton, useEstateView } from './kit'
import { assetStatus, calendarDate, isMathematicallyComplete, reviewItems, type EstateView } from './model'
import { PlanDetailsForm } from './PlanDetailsForm'

export default function EstateOverviewPage() {
  usePageTitle('Estate planning')
  const { view, isLoading, error, refetch } = useEstateView()
  if (error) return <ErrorState error={error} onRetry={refetch} title="Your estate plan couldn't be loaded" />
  if (isLoading || !view) return <EstateSkeleton />
  const w = view.workspace
  const fresh = !w.plan && w.beneficiaries.length === 0 && w.directives.length === 0
  return fresh ? <FirstStep /> : <Overview view={view} />
}

/** No plan yet: explain the three parts, then ask for the one thing needed to begin. */
function FirstStep() {
  return (
    <Card>
      <div className="grid gap-8 p-5 md:p-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0">
          <div className="mb-4 grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
            <ScrollText size={22} aria-hidden />
          </div>
          <h2 className="text-lg font-semibold text-ink">Start your estate plan</h2>
          <p className="mt-2 text-sm text-muted">
            Name the plan and note where you live. Then add the people, organizations, or trusts you want to provide for, and decide what each asset should go to.
          </p>
          <ol className="mt-5 flex flex-col gap-3 text-sm">
            <StepHint n={1}>Name your plan and record a review date.</StepHint>
            <StepHint n={2}>Add beneficiaries. They never get access to Wealthboard.</StepHint>
            <StepHint n={3}>Give each asset exact primary and contingent shares.</StepHint>
            <StepHint n={4}>Keep a dated summary to print or discuss with an adviser.</StepHint>
          </ol>
        </div>
        <div className="min-w-0 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <h3 className="mb-4 text-md font-semibold text-ink">Plan details</h3>
          <PlanDetailsForm plan={null} submitLabel="Start my plan" />
        </div>
      </div>
    </Card>
  )
}

function StepHint({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="num grid size-6 shrink-0 place-items-center rounded-full border border-line-strong text-xs font-semibold text-muted">{n}</span>
      <span className="pt-0.5 text-ink">{children}</span>
    </li>
  )
}

function Overview({ view }: { view: EstateView }) {
  const { today } = usePrefs()
  const [editing, setEditing] = useState(false)
  const plan = view.workspace.plan
  const items = reviewItems(view, today)
  const blocking = items.filter((i) => i.severity === 'blocking').length
  const warnings = items.length - blocking
  const included = view.assets.filter((a) => a.isIncluded)
  const settled = included.filter((a) => {
    const s = assetStatus(a, view.residuaryPrimaryBps)
    return s === 'complete' || s === 'covered'
  }).length
  const reviewDue = !!plan?.reviewReminderDate && calendarDate(plan.reviewReminderDate) <= today
  const latest = view.workspace.snapshots[0]
  const mathComplete = isMathematicallyComplete(items)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
      <Card>
        <CardHeader
          title={plan?.title ?? 'My estate plan'}
          description={plan?.jurisdiction ? `Jurisdiction reference: ${plan.jurisdiction}` : 'No jurisdiction recorded'}
          action={
            editing ? null : (
              <Button variant="secondary" icon={<Pencil size={16} aria-hidden />} onClick={() => setEditing(true)}>
                Edit details
              </Button>
            )
          }
        />
        <CardBody>
          {editing ? (
            <div className="flex flex-col gap-3">
              <PlanDetailsForm plan={plan} onSaved={() => setEditing(false)} />
              <div>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted">Last reviewed</dt>
                <dd className="mt-0.5 text-base text-ink">{plan?.lastReviewedDate ? <DateText value={calendarDate(plan.lastReviewedDate)} /> : <span className="text-subtle">Not recorded</span>}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Review again on</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-base text-ink">
                  {plan?.reviewReminderDate ? <DateText value={calendarDate(plan.reviewReminderDate)} /> : <span className="text-subtle">No reminder set</span>}
                  {reviewDue ? <Badge tone="warning">Review due</Badge> : null}
                </dd>
              </div>
            </dl>
          )}
        </CardBody>
      </Card>

      <Card aria-labelledby="estate-progress">
        <CardHeader id="estate-progress" title="Where the plan stands" description={mathComplete ? 'Allocation math is complete. That is not a legal-validity check.' : 'Work through these in order.'} />
        <CardBody className="pt-1">
          <ol className="divide-y divide-line">
            <ProgressStep
              n={1}
              done={!!plan}
              title="Plan details"
              detail={plan?.lastReviewedDate ? 'Recorded and reviewed' : 'Record when you last reviewed the plan'}
              action={
                <Button variant="ghost" className="-mr-2 gap-1" onClick={() => setEditing(true)}>
                  Edit
                  <Pencil size={14} aria-hidden />
                </Button>
              }
            />
            <ProgressStep
              n={2}
              done={view.activeBeneficiaries.length > 0}
              title="Beneficiaries"
              detail={view.activeBeneficiaries.length ? `${view.activeBeneficiaries.length} active` : 'None yet'}
              action={<StepLink to="/estate/beneficiaries" label={view.activeBeneficiaries.length ? 'Manage' : 'Add'} />}
            />
            <ProgressStep
              n={3}
              done={included.length > 0 && settled === included.length && mathComplete}
              title="Distribution"
              detail={included.length ? `${settled} of ${included.length} included assets fully allocated` : 'No included assets'}
              action={<StepLink to="/estate/distribution" label="Allocate" />}
            />
            <ProgressStep
              n={4}
              done={!!latest}
              title="Summary"
              detail={
                <>
                  {blocking ? `${blocking} decision${blocking === 1 ? '' : 's'} needed` : 'No blocking decisions'}
                  {warnings ? ` · ${warnings} to review` : ''}
                  {latest ? (
                    <>
                      {' · Last summary '}
                      <DateText value={latest.generatedAt} />
                    </>
                  ) : null}
                </>
              }
              action={<StepLink to="/estate/summary" label="Review" />}
            />
          </ol>
        </CardBody>
      </Card>
    </div>
  )
}

function StepLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className={buttonClass({ variant: 'ghost', className: '-mr-2 gap-1' })}>
      {label}
      <ArrowRight size={15} aria-hidden />
    </Link>
  )
}

function ProgressStep({ n, done, title, detail, action }: { n: number; done: boolean; title: string; detail: ReactNode; action: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className={cn('num grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold', done ? 'bg-positive-soft text-positive' : 'border border-line-strong text-muted')}
        aria-hidden
      >
        {done ? <Check size={14} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {title}
          <span className="sr-only">{done ? ', done' : ', to do'}</span>
        </p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  )
}
