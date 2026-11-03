import { ArrowLeft, Ban, CheckCircle2, MoreHorizontal, Pause, Pencil, Play, RotateCcw, SearchX, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import type { Goal, GoalStatus } from '@/api/types'
import { Button, buttonClass, IconButton } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/Menu'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation, useGoal } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { EditGoalSheet } from './EditGoalSheet'
import { GoalHero } from './GoalHero'
import { GoalIcon, GoalStatusBadge, missingRateHref } from './goalMeta'
import { LinkedAccountHistory } from './LinkedAccountHistory'
import { Milestones } from './Milestones'
import { ProjectionChart } from './ProjectionChart'
import { WhatIfPanel } from './WhatIfPanel'

const STATUS_TOAST: Record<GoalStatus, string> = {
  active: 'Goal is active again. Reminders are back on.',
  paused: 'Goal paused. Reminders are off until you resume it.',
  completed: 'Goal marked complete. Well done!',
  cancelled: 'Goal cancelled',
}

const backLink = (
  <Link to="/goals" className="inline-flex h-9 items-center gap-1.5 rounded-md text-sm font-medium text-muted hover:text-ink">
    <ArrowLeft size={16} aria-hidden />
    Goals
  </Link>
)

function DetailSkeleton() {
  return (
    <div className="page" role="status" aria-label="Loading goal">
      <Skeleton className="mb-3 h-5 w-16" />
      <div className="mb-8 flex items-center gap-3">
        <Skeleton className="size-12 rounded-lg" />
        <Skeleton className="h-8 w-64 max-w-[70%]" />
      </div>
      <div className="card grid gap-6 p-5 md:grid-cols-[1.45fr_1fr] md:p-7">
        <div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-10 w-64 max-w-full" />
          <Skeleton className="mt-3 h-4 w-48" />
          <Skeleton className="mt-6 h-2 w-full rounded-full" />
          <Skeleton className="mt-6 h-16 w-full" />
        </div>
        <div className="grid content-start gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
      <Skeleton className="mt-6 h-80 w-full rounded-lg" />
    </div>
  )
}

function GoalNotices({ goal }: { goal: Goal }) {
  const notices: ReactNode[] = []
  if (goal.valueIncomplete) {
    const href = missingRateHref(goal)
    notices.push(
      <Notice
        key="incomplete"
        tone="warning"
        title="Progress is incomplete"
        action={
          href ? (
            <Link to={href} className={buttonClass({ size: 'sm' })}>
              Add {goal.missingCurrencies[0]} → {goal.currency} rate
            </Link>
          ) : goal.linkedAccount ? (
            <Link to={`/accounts/${goal.linkedAccount.id}`} className={buttonClass({ size: 'sm' })}>
              Review {goal.linkedAccount.name}
            </Link>
          ) : undefined
        }
      >
        {goal.missingCurrencies.length > 0
          ? `${goal.linkedAccount?.name ?? 'The linked account'} holds ${goal.missingCurrencies.join(', ')}, and there is no exchange rate to ${goal.currency}. Until one is added, the current amount, progress, and tracking status can't be worked out.`
          : `${goal.linkedAccount?.name ?? 'The linked account'} has a holding without a price, so its value and this goal's progress are incomplete.`}
      </Notice>,
    )
  }
  if (goal.status === 'paused')
    notices.push(
      <Notice key="paused" tone="info" title="This goal is paused">
        It stays out of reminders until you resume it. The projection still shows where the saved plan would lead.
      </Notice>,
    )
  if (goal.status === 'completed')
    notices.push(
      <Notice key="completed" tone="positive" title="You reached this goal!">
        It's kept here for the record. Reopen it if you want to keep tracking.
      </Notice>,
    )
  if (notices.length === 0) return null
  return <div className="grid gap-2">{notices}</div>
}

function GoalDetail({ goal, onDeleted }: { goal: Goal; onDeleted(): void }) {
  const navigate = useNavigate()
  const online = useOnline()
  const [confirm, setConfirm] = useState<'complete' | 'delete' | null>(null)

  // ?edit=1 opens the edit sheet (the legacy /goals/:id/edit redirects here); closing removes it.
  const [params, setParams] = useSearchParams()
  const editOpen = params.get('edit') === '1'
  const [edit, setEdit] = useState({ open: editOpen, seq: 0 })
  if (edit.open !== editOpen) setEdit({ open: editOpen, seq: editOpen ? edit.seq + 1 : edit.seq })
  const setEditOpen = (open: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (open) next.set('edit', '1')
        else next.delete('edit')
        return next
      },
      { replace: true },
    )

  const setStatus = useApiMutation({
    mutationFn: (status: GoalStatus) => api.goals.setStatus(goal.id, status),
    success: (_r, status) => STATUS_TOAST[status],
    onSuccess: () => setConfirm(null),
  })
  const remove = useApiMutation({
    mutationFn: async () => {
      await api.goals.remove(goal.id)
      // Hide the page before the cache refresh turns this goal into "not found".
      onDeleted()
    },
    success: `“${goal.name}” deleted`,
    onSuccess: () => navigate('/goals', { replace: true }),
  })

  const offlineTitle = online ? undefined : OFFLINE_REASON
  const busy = setStatus.isPending
  const status = goal.status as GoalStatus

  const primaryActions: ReactNode =
    status === 'active' ? (
      <>
        <Button icon={<Pause size={16} aria-hidden />} onClick={() => setStatus.mutate('paused')} disabled={!online || busy} title={offlineTitle}>
          Pause
        </Button>
        <Button variant="primary" icon={<CheckCircle2 size={16} aria-hidden />} onClick={() => setConfirm('complete')} disabled={!online || busy} title={offlineTitle}>
          Mark complete
        </Button>
      </>
    ) : status === 'paused' ? (
      <>
        <Button variant="primary" icon={<Play size={16} aria-hidden />} onClick={() => setStatus.mutate('active')} loading={busy} disabled={!online} title={offlineTitle}>
          Resume
        </Button>
        <Button icon={<CheckCircle2 size={16} aria-hidden />} onClick={() => setConfirm('complete')} disabled={!online || busy} title={offlineTitle}>
          Mark complete
        </Button>
      </>
    ) : (
      <Button icon={<RotateCcw size={16} aria-hidden />} onClick={() => setStatus.mutate('active')} loading={busy} disabled={!online} title={offlineTitle}>
        {status === 'completed' ? 'Reopen' : 'Reactivate'}
      </Button>
    )

  return (
    <div className="page">
      <PageHeader
        back={backLink}
        title={
          <span className="flex items-center gap-3">
            <GoalIcon name={goal.icon} size="lg" />
            <span className="min-w-0">{goal.name}</span>
          </span>
        }
        description={
          goal.description || goal.status !== 'active' ? (
            <span className="flex flex-wrap items-center gap-2">
              {goal.status !== 'active' ? <GoalStatusBadge status={goal.status} /> : null}
              {goal.description ? <span>{goal.description}</span> : null}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button icon={<Pencil size={16} aria-hidden />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            {primaryActions}
            <MenuRoot>
              <MenuTrigger asChild>
                <IconButton label="More goal actions" icon={<MoreHorizontal size={18} aria-hidden />} variant="secondary" tooltip={false} />
              </MenuTrigger>
              <MenuContent>
                {status === 'active' || status === 'paused' ? (
                  <MenuItem icon={<Ban />} onSelect={() => setStatus.mutate('cancelled')} disabled={!online}>
                    Cancel goal
                  </MenuItem>
                ) : null}
                <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => setConfirm('delete')} disabled={!online} hint={online ? undefined : 'Offline'}>
                  Delete goal
                </MenuItem>
              </MenuContent>
            </MenuRoot>
          </>
        }
      />

      <div className="grid gap-6 md:gap-8">
        <GoalNotices goal={goal} />
        <GoalHero goal={goal} />

        <Card aria-labelledby="projection-title">
          <CardHeader id="projection-title" title="Projection" description="Where the saved plan leads by the target date" />
          <CardBody>
            <ProjectionChart goal={goal} />
          </CardBody>
        </Card>

        {goal.status === 'completed' || goal.status === 'cancelled' ? null : <WhatIfPanel goal={goal} />}

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Milestones goal={goal} />
          <LinkedAccountHistory goal={goal} />
        </div>
      </div>

      <EditGoalSheet key={edit.seq} goal={goal} open={editOpen} onOpenChange={setEditOpen} />
      <ConfirmDialog
        open={confirm === 'complete'}
        onOpenChange={(o) => setConfirm(o ? 'complete' : null)}
        title={`Mark “${goal.name}” as complete?`}
        description="Tracking and reminders stop, and it moves to your completed goals. You can reopen it later."
        confirmLabel="Mark complete"
        tone="primary"
        onConfirm={() => setStatus.mutate('completed')}
        pending={setStatus.isPending}
        confirmDisabled={!online}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => setConfirm(o ? 'delete' : null)}
        title={`Delete “${goal.name}”?`}
        description={
          goal.linkedAccount
            ? `The goal and its milestones are deleted. ${goal.linkedAccount.name} and its history stay exactly as they are.`
            : 'The goal, its manual amount, and its milestones are deleted. This cannot be undone.'
        }
        confirmLabel="Delete goal"
        onConfirm={() => remove.mutate(undefined)}
        pending={remove.isPending}
        confirmDisabled={!online}
      >
        {goal.status !== 'completed' ? <p className="text-sm text-muted">If you've simply stopped saving for it, pausing or cancelling keeps the history.</p> : null}
      </ConfirmDialog>
    </div>
  )
}

export default function GoalDetailPage() {
  const { goalId } = useParams()
  const query = useGoal(goalId)
  const [deletedId, setDeletedId] = useState<string | null>(null)
  usePageTitle(query.data?.name ?? 'Goal')

  if (query.isPending || (goalId && deletedId === goalId)) return <DetailSkeleton />
  if (query.isError) {
    const notFound = ApiProblem.is(query.error) && query.error.status === 404
    return (
      <div className="page">
        <PageHeader back={backLink} title={notFound ? 'Goal not found' : 'Goal'} />
        <div className="card">
          {notFound ? (
            <EmptyState
              icon={<SearchX size={22} aria-hidden />}
              title="This goal doesn't exist"
              action={
                <Link to="/goals" className={buttonClass({ variant: 'primary' })}>
                  View all goals
                </Link>
              }
            >
              It may have been deleted, or the link is mistyped.
            </EmptyState>
          ) : (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} title="This goal couldn't be loaded" />
          )}
        </div>
      </div>
    )
  }
  return <GoalDetail key={query.data.id} goal={query.data} onDeleted={() => setDeletedId(query.data.id)} />
}
