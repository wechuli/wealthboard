import { useId, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, ChevronRight, History } from 'lucide-react'
import type { Account } from '@/api/types'
import { Sheet } from '@/components/ui/Dialog'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { useAccounts } from '@/lib/queries'
import { ACTIONS, accountAllows, actionMeta, type ActionMeta } from './actions'
import { GoalForm } from './forms/GoalForm'
import { PriceForm, TradeForm } from './forms/InvestmentForms'
import { TransactionForm } from './forms/TransactionForm'
import { TransferForm, ValuationForm } from './forms/ValueForms'
import type { RecordAction, RecorderOpenOptions } from './recorder'
import { readLastRecording, rememberRecording, SubmitBar } from './shared'

const SUBMIT_LABEL: Partial<Record<RecordAction, string>> = {
  valuation: 'Save value',
  price: 'Save price',
  buy: 'Record trade',
  sell: 'Record trade',
  transfer: 'Record transfer',
  goal: 'Create goal',
}

function ActionPicker({ account, onPick, last, onLast }: { account?: Account; onPick(a: RecordAction): void; last: ReturnType<typeof readLastRecording>; onLast(): void }) {
  const actions = ACTIONS.filter((a) => (account ? a.group !== 'Create' && accountAllows(account, a.action) : true))
  const groups = [...new Set(actions.map((a) => a.group))]
  return (
    <div className="flex flex-col gap-6">
      {last && !account ? (
        <button type="button" onClick={onLast} className="flex min-h-14 items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft/60 px-4 text-left transition-colors hover:bg-accent-soft">
          <History size={18} aria-hidden className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Repeat: {actionMeta(last.action).label}</span>
            <span className="block text-xs text-muted">Same action and account as last time</span>
          </span>
          <ChevronRight size={18} aria-hidden className="text-muted" />
        </button>
      ) : null}
      {groups.map((group) => (
        <section key={group} aria-label={group}>
          <h3 className="mb-2 text-xs font-medium text-subtle">{group}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {actions
              .filter((a) => a.group === group)
              .map((a) => (
                <ActionTile key={a.action} meta={a} onPick={onPick} />
              ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ActionTile({ meta, onPick }: { meta: ActionMeta; onPick(a: RecordAction): void }) {
  const Icon = meta.icon
  return (
    <button
      type="button"
      onClick={() => onPick(meta.action)}
      className="flex min-h-[4.75rem] flex-col items-start justify-between gap-2 rounded-lg border border-line bg-surface p-3 text-left transition-[border-color,background-color,transform] duration-[var(--dur-1)] hover:border-line-strong hover:bg-sunken/50 active:translate-y-px"
    >
      <Icon size={19} aria-hidden strokeWidth={1.75} className="text-accent" />
      <span>
        <span className="block text-sm font-semibold text-ink">{meta.label}</span>
        <span className="block text-xs leading-snug text-muted">{meta.description}</span>
      </span>
    </button>
  )
}

/** Quick add: pick an action (filtered by the account's mode), then fill a focused form. */
export default function RecorderSheet({ open, options, onOpenChange }: { open: boolean; options: RecorderOpenOptions; onOpenChange(o: boolean): void }) {
  const navigate = useNavigate()
  const formId = useId()
  const accounts = useAccounts('active')
  const last = useMemo(() => readLastRecording(), [])
  const [action, setAction] = useState<RecordAction | undefined>(options.action)
  const [accountId, setAccountId] = useState<string | undefined>(options.accountId)
  const [pending, setPending] = useState(false)
  const scopedAccount = options.accountId ? accounts.data?.find((a) => a.id === options.accountId) : undefined
  const close = () => onOpenChange(false)

  const pick = (a: RecordAction) => {
    if (a === 'account') {
      close()
      navigate('/accounts/new')
      return
    }
    setAction(a)
  }

  const done = (a: RecordAction) => (id?: string) => {
    rememberRecording({ action: a, accountId: id })
    close()
  }

  const meta = action ? actionMeta(action) : undefined
  const list = accounts.data ?? []
  // Launched from an account page → that account; otherwise the most recently used one.
  const initial = accountId ?? last?.accountId

  let body: ReactNode
  if (accounts.isPending) body = <Skeleton className="h-64" label="Loading accounts" />
  else if (accounts.isError) body = <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} compact />
  else if (!action)
    body = (
      <ActionPicker
        account={scopedAccount}
        last={last}
        onPick={pick}
        onLast={() => {
          if (!last) return
          setAccountId(last.accountId)
          pick(last.action)
        }}
      />
    )
  else if (action === 'valuation') body = <ValuationForm formId={formId} accounts={list} initialAccountId={initial} onDone={done('valuation')} onPendingChange={setPending} />
  else if (action === 'transfer') body = <TransferForm formId={formId} accounts={list} initialAccountId={initial} onDone={done('transfer')} onPendingChange={setPending} />
  else if (action === 'buy' || action === 'sell')
    body = <TradeForm formId={formId} side={action} accounts={list} initialAccountId={initial} initialInstrumentId={options.instrumentId} onDone={(id, side) => done(side)(id)} onPendingChange={setPending} />
  else if (action === 'price') body = <PriceForm formId={formId} initialInstrumentId={options.instrumentId} onDone={() => done('price')(initial)} onPendingChange={setPending} />
  else if (action === 'goal')
    body = (
      <GoalForm
        formId={formId}
        accounts={list}
        onDone={(goalId) => {
          done('goal')()
          navigate(`/goals/${goalId}`)
        }}
        onPendingChange={setPending}
      />
    )
  else body = <TransactionForm key={action} formId={formId} action={action} accounts={list} initialAccountId={initial} onDone={done(action)} onPendingChange={setPending} />

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        meta ? (
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => setAction(undefined)} aria-label="Back to all actions" className="-ml-2 grid size-9 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink">
              <ArrowLeft size={18} aria-hidden />
            </button>
            {meta.title}
          </span>
        ) : (
          'Record something'
        )
      }
      description={meta ? (scopedAccount ? `For ${scopedAccount.name}` : meta.description) : scopedAccount ? `Actions for ${scopedAccount.name}` : 'Keep your accounts current. Press N anywhere to open this.'}
      footer={meta ? <SubmitBar formId={formId} label={SUBMIT_LABEL[meta.action] ?? `Record ${meta.label.toLowerCase()}`} pending={pending} onCancel={close} /> : undefined}
    >
      {body}
    </Sheet>
  )
}
