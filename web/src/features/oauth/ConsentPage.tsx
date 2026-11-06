import { useMutation } from '@tanstack/react-query'
import { Ban, Eye, Lock, PencilLine, PlugZap } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import type { OAuthDataLevel } from '@/api/types'
import { Button, buttonClass } from '@/components/ui/Button'
import { ChoiceCards, SwitchField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { AuthCard, AuthLayout } from '@/features/auth/AuthLayout'
import { ProblemNotice } from '@/features/settings/settings-kit'
import { leaveApp } from '@/lib/browser'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useOAuthRequest } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { usePageTitle } from '@/lib/usePageTitle'

export const WRITE_SCOPE = 'portfolio:write'

export const DATA_LEVELS: { value: OAuthDataLevel; title: string; description: string }[] = [
  {
    value: 'detailed',
    title: 'Detailed',
    description: 'Accounts, balances, transactions and their descriptions, goals, holdings, and reports.',
  },
  {
    value: 'summary',
    title: 'Summary only',
    description: 'Totals, allocation by category and currency, cash flow, and income. No account, goal, or transaction details.',
  },
]

function Expired() {
  return (
    <AuthCard title="This connection request has expired" description="Connection requests last ten minutes and can be answered only once.">
      <p className="text-sm text-muted">Start the connection again from your AI assistant. Nothing was shared.</p>
      <Link to="/" className={buttonClass({ variant: 'secondary', className: 'mt-5 w-full' })}>
        Go to Wealthboard
      </Link>
    </AuthCard>
  )
}

export default function ConsentPage() {
  usePageTitle('Connect an AI assistant')
  const [params] = useSearchParams()
  const requestId = params.get('request')
  const { user } = useSession()
  const online = useOnline()
  const request = useOAuthRequest(requestId)
  const [dataLevel, setDataLevel] = useState<OAuthDataLevel>('detailed')
  const [allowChanges, setAllowChanges] = useState(false)
  const wantsChanges = request.data?.scopes.includes(WRITE_SCOPE) ?? false
  const changes = wantsChanges && allowChanges && dataLevel === 'detailed'
  // Changes need detailed access, so choosing Summary turns them off until the user turns them on again.
  const chooseDataLevel = (level: OAuthDataLevel) => {
    setDataLevel(level)
    if (level !== 'detailed') setAllowChanges(false)
  }
  const decide = useMutation({
    mutationFn: (approve: boolean) => (approve ? api.oauth.approve(requestId!, dataLevel, changes) : api.oauth.deny(requestId!)),
    onSuccess: ({ redirectTo }) => leaveApp(redirectTo),
  })

  let content
  if (!requestId || (request.isError && ApiProblem.is(request.error) && request.error.status === 404)) {
    content = <Expired />
  } else if (request.isPending) {
    content = (
      <div className="card p-6" role="status" aria-label="Loading">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-6 h-24 w-full" />
      </div>
    )
  } else if (request.isError) {
    content = (
      <AuthCard title="Can't load this request">
        <ProblemNotice error={request.error} />
      </AuthCard>
    )
  } else {
    const consent = request.data
    const busy = decide.isPending || decide.isSuccess
    content = (
      <AuthCard
        title={`Connect ${consent.clientName}?`}
        description={
          <>
            It's asking to {wantsChanges ? 'read and add to' : 'read'} your Wealthboard data{user ? <> as <span className="font-medium text-ink">@{user.username}</span></> : null}, then return to{' '}
            <span className="font-medium text-ink">{consent.redirectHost}</span>.
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <Notice tone="warning" title="Only continue if you started this">
            The application chose its own name. Allow access only if you just connected Wealthboard from an assistant that returns to {consent.redirectHost}.
          </Notice>
          <ChoiceCards<OAuthDataLevel> name="data-level" legend="What it can read" value={dataLevel} onChange={chooseDataLevel} columns={1} options={DATA_LEVELS} />
          {wantsChanges ? (
            <div className="rounded-md border border-line p-3">
              <SwitchField
                label="Allow changes"
                description={
                  dataLevel === 'detailed'
                    ? "It can record new transactions and valuations when you ask it to. It can't edit or delete anything."
                    : 'Changes need detailed access.'
                }
                checked={changes}
                onCheckedChange={setAllowChanges}
                disabled={dataLevel !== 'detailed'}
              />
            </div>
          ) : null}
          <ul className="flex flex-col gap-2 text-sm text-muted">
            <li className="flex gap-2.5">
              {changes ? (
                <>
                  <PencilLine size={16} aria-hidden className="mt-0.5 shrink-0 text-subtle" />
                  Adds only: it can record transactions and valuations, but can't edit or delete anything.
                </>
              ) : (
                <>
                  <Eye size={16} aria-hidden className="mt-0.5 shrink-0 text-subtle" />
                  Read-only: it can't record, change, or delete anything.
                </>
              )}
            </li>
            <li className="flex gap-2.5">
              <Lock size={16} aria-hidden className="mt-0.5 shrink-0 text-subtle" />
              Never shared: account numbers, private notes, passwords, or API keys.
            </li>
            <li className="flex gap-2.5">
              <PlugZap size={16} aria-hidden className="mt-0.5 shrink-0 text-subtle" />
              What it reads leaves Wealthboard under the assistant provider's terms. Disconnect it any time in Settings → Connected apps.
            </li>
          </ul>
          <ProblemNotice error={decide.error} />
          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Button icon={<Ban size={16} aria-hidden />} disabled={busy || !online} onClick={() => decide.mutate(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={decide.isPending && decide.variables === true} disabled={busy || !online} title={online ? undefined : OFFLINE_REASON} onClick={() => decide.mutate(true)}>
              Allow access
            </Button>
          </div>
        </div>
      </AuthCard>
    )
  }
  return <AuthLayout>{content}</AuthLayout>
}
