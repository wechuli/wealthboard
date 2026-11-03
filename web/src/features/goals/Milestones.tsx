import { CheckCircle2, Circle, Clock, Flag, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '@/api'
import { ApiProblem, problemMessage } from '@/api/problem'
import type { Goal, GoalMilestone } from '@/api/types'
import { DateText, Money, Percent } from '@/components/format'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog, Sheet } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { AmountField, DateField, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { decimalToMinor, minorSign, minorToDecimal, PrecisionError } from '@/lib/money'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation, useGoalMilestones } from '@/lib/queries'

const STATUS = {
  reached: { label: 'Reached', icon: CheckCircle2, className: 'text-positive' },
  upcoming: { label: 'Upcoming', icon: Circle, className: 'text-subtle' },
  overdue: { label: 'Overdue', icon: Clock, className: 'text-warning' },
} as const

function statusMeta(status: string) {
  return STATUS[status as keyof typeof STATUS] ?? STATUS.upcoming
}

function AddMilestoneSheet({ goal, open, onOpenChange }: { goal: Goal; open: boolean; onOpenChange(open: boolean): void }) {
  const online = useOnline()
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [errors, setErrors] = useState<{
    name?: string
    amount?: string
    date?: string
  }>({})
  const [formError, setFormError] = useState<string | null>(null)

  const mutation = useApiMutation({
    mutationFn: (body: Parameters<typeof api.goals.createMilestone>[1]) => api.goals.createMilestone(goal.id, body),
    success: (_r, body) => `Milestone “${body.name}” added`,
    toastError: false,
    onSuccess: () => onOpenChange(false),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const next: typeof errors = {}
    let targetAmount = ''
    if (!name.trim()) next.name = 'Give the milestone a name'
    try {
      const minor = decimalToMinor(amount, goal.currency)
      if (minorSign(minor) <= 0) next.amount = 'Enter an amount greater than zero'
      else targetAmount = minorToDecimal(minor, goal.currency)
    } catch (err) {
      next.amount = err instanceof PrecisionError ? err.message : 'Enter an amount'
    }
    setErrors(next)
    if (Object.values(next).some(Boolean)) return
    mutation.mutate(
      { name: name.trim(), targetAmount, targetDate: date || undefined },
      {
        onError: (err) => {
          const fe = ApiProblem.is(err) ? err.fieldErrors : undefined
          if (fe)
            setErrors({
              name: fe.name,
              amount: fe.targetAmount,
              date: fe.targetDate,
            })
          setFormError(problemMessage(err))
        },
      },
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add a milestone"
      description={`A checkpoint on the way to ${goal.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-milestone" loading={mutation.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
            Add milestone
          </Button>
        </>
      }
    >
      <form id="add-milestone" onSubmit={submit} className="grid gap-5" noValidate>
        {!online ? (
          <Notice tone="warning" title="You're offline">
            {OFFLINE_REASON}
          </Notice>
        ) : null}
        {formError ? (
          <Notice tone="negative" title="The milestone wasn't added" role="alert">
            {formError}
          </Notice>
        ) : null}
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder={`First ${goal.currency} 1,000,000`} maxLength={120} autoFocus />
        <AmountField label="Amount to reach" currency={goal.currency} value={amount} onChange={setAmount} error={errors.amount} hint="Reached when the goal's current amount gets here." />
        <DateField label="Reach by" optional value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} hint="Past this date, an unreached milestone shows as overdue." />
      </form>
    </Sheet>
  )
}

function DeleteMilestoneDialog({ goalId, milestone, open, onOpenChange }: { goalId: string; milestone: GoalMilestone; open: boolean; onOpenChange(open: boolean): void }) {
  const online = useOnline()
  const mutation = useApiMutation({
    mutationFn: () => api.goals.removeMilestone(goalId, milestone.id),
    success: 'Milestone deleted',
    onSuccess: () => onOpenChange(false),
  })
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete “${milestone.name}”?`}
      description="This removes the checkpoint only. The goal and its progress don't change."
      confirmLabel="Delete milestone"
      onConfirm={() => mutation.mutate(undefined)}
      pending={mutation.isPending}
      confirmDisabled={!online}
    >
      {!online ? (
        <Notice tone="warning" title="You're offline">
          {OFFLINE_REASON}
        </Notice>
      ) : null}
    </ConfirmDialog>
  )
}

export function Milestones({ goal }: { goal: Goal }) {
  const online = useOnline()
  const query = useGoalMilestones(goal.id)
  const [adding, setAdding] = useState(false)
  const [addKey, setAddKey] = useState(0)
  const [removing, setRemoving] = useState<{
    milestone: GoalMilestone
    open: boolean
  } | null>(null)

  const openAdd = () => {
    setAddKey((k) => k + 1)
    setAdding(true)
  }

  return (
    <Card aria-labelledby="milestones-title">
      <CardHeader
        id="milestones-title"
        title="Milestones"
        description="Checkpoints on the way to the target"
        action={
          query.data && query.data.length > 0 ? (
            <Button size="sm" icon={<Plus size={15} aria-hidden />} onClick={openAdd} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
              Add
            </Button>
          ) : undefined
        }
      />
      <CardBody className="pt-2">
        {query.isPending ? (
          <div className="grid gap-4 pt-2" role="status" aria-label="Loading milestones">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-5 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-2 h-3 w-56 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState compact error={query.error} onRetry={() => void query.refetch()} title="Milestones couldn't be loaded" />
        ) : query.data.length === 0 ? (
          <EmptyState
            compact
            icon={<Flag size={20} aria-hidden />}
            title="No milestones yet"
            action={
              <Button icon={<Plus size={16} aria-hidden />} onClick={openAdd} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
                Add a milestone
              </Button>
            }
          >
            Break a big target into checkpoints you can celebrate, such as your first million. They're ticked off automatically as progress passes them.
          </EmptyState>
        ) : (
          <ol className="divide-y divide-line">
            {query.data.map((m) => {
              const meta = statusMeta(m.status)
              const Icon = meta.icon
              return (
                <li key={m.id} className="flex items-start gap-3 py-3">
                  <Icon size={19} aria-hidden className={cn('mt-0.5 shrink-0', meta.className)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="min-w-0 font-medium text-ink">{m.name}</p>
                      <Money minor={m.targetAmountMinor} currency={goal.currency} className="text-sm text-ink" />
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className={cn('font-medium', meta.className === 'text-subtle' ? 'text-muted' : meta.className)}>{meta.label}</span>
                      {m.targetDate ? (
                        <>
                          {' · by '}
                          <DateText value={m.targetDate} />
                        </>
                      ) : null}
                      {m.remainingMinor ? (
                        <>
                          {' · '}
                          <Money minor={m.remainingMinor} currency={goal.currency} /> to go
                        </>
                      ) : null}
                    </p>
                    {m.status !== 'reached' ? (
                      <div className="mt-2 flex items-center gap-2.5">
                        <ProgressBar percent={m.progressPercent} tone={m.status === 'overdue' ? 'warning' : 'accent'} incomplete={goal.valueIncomplete} label={`${m.name} progress`} />
                        <Percent value={m.progressPercent} className="w-11 shrink-0 text-right text-xs text-muted" />
                      </div>
                    ) : null}
                  </div>
                  <IconButton
                    label={`Delete milestone ${m.name}`}
                    icon={<Trash2 size={16} aria-hidden />}
                    className="-my-1.5 -mr-2 shrink-0"
                    onClick={() => setRemoving({ milestone: m, open: true })}
                    disabled={!online}
                  />
                </li>
              )
            })}
          </ol>
        )}
      </CardBody>
      {addKey > 0 ? <AddMilestoneSheet key={addKey} goal={goal} open={adding} onOpenChange={setAdding} /> : null}
      {removing ? (
        <DeleteMilestoneDialog key={removing.milestone.id} goalId={goal.id} milestone={removing.milestone} open={removing.open} onOpenChange={(open) => setRemoving((r) => (r ? { ...r, open } : r))} />
      ) : null}
    </Card>
  )
}
