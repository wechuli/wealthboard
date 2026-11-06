import { Check, Copy, PlugZap, ShieldCheck, Trash2, Unplug } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api'
import type { ConnectedApp } from '@/api/types'
import { DateText, RelativeDate } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation, useConnectedApps } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { Disclosure, ListSkeleton, ProblemNotice, SettingsPanel, SettingsStack } from './settings-kit'

const TOOL_LABELS: Record<string, string> = {
  get_portfolio_summary: 'Portfolio summary',
  list_accounts: 'Accounts',
  get_account: 'Account details',
  list_transactions: 'Transactions',
  get_cash_flow_report: 'Cash flow report',
  get_income_report: 'Income report',
  list_goals: 'Goals',
  get_goal: 'Goal details',
  get_holdings: 'Holdings',
  get_attention_items: 'Attention items',
  record_transaction: 'Recorded a transaction',
  record_valuation: 'Recorded a valuation',
}

function McpAddress() {
  const address = `${window.location.origin}/mcp`
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      toast.success('Address copied')
    } catch {
      toast.info('Copy the address with your keyboard', { description: 'This browser blocked clipboard access.' })
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-md bg-sunken/70 px-3.5 py-3 text-sm text-muted">
      <p>
        Add Wealthboard as a custom connector in Claude or ChatGPT with this address. The assistant sends you here to approve it. Tools such as
        Claude Code, VS Code, Cursor, and Codex can use an API key instead.
      </p>
      <div className="flex items-center gap-2">
        <code className="num min-w-0 flex-1 truncate rounded-sm bg-surface px-2 py-1 font-mono text-xs text-ink">{address}</code>
        <Button size="sm" icon={copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

function AppCard({ app, online, onDisconnect }: { app: ConnectedApp; online: boolean; onDisconnect(app: ConnectedApp): void }) {
  const clear = useApiMutation<void, void>({
    mutationFn: () => api.connectedApps.clearCalls(app.id),
    success: 'Activity history cleared',
  })
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
            <span className="truncate">{app.clientName}</span>
            <Badge tone={app.dataLevel === 'summary' ? 'neutral' : 'accent'}>{app.dataLevel === 'summary' ? 'Summary only' : 'Detailed'}</Badge>
            {app.scopes.includes('portfolio:write') ? <Badge tone="warning">Can make changes</Badge> : null}
          </p>
          <p className="mt-0.5 truncate text-sm text-muted">Returns to {app.redirectHost}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Unplug size={15} aria-hidden />}
          disabled={!online}
          title={online ? undefined : OFFLINE_REASON}
          aria-label={`Disconnect ${app.clientName}`}
          onClick={() => onDisconnect(app)}
        >
          Disconnect
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr_auto_1fr]">
        <dt className="text-muted">Connected</dt>
        <dd className="text-ink">
          <DateText value={app.createdAt} />
        </dd>
        <dt className="text-muted">Last used</dt>
        <dd className="text-ink">{app.lastUsedAt ? <RelativeDate value={app.lastUsedAt} /> : <span className="text-subtle">Not yet</span>}</dd>
      </dl>
      {app.recentCalls.length > 0 ? (
        <Disclosure label="Recent activity" count={app.recentCalls.length}>
          <ul className="flex flex-col divide-y divide-line text-sm" aria-label={`Recent activity for ${app.clientName}`}>
            {app.recentCalls.map((call, index) => (
              <li key={`${call.at}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1 text-ink">{TOOL_LABELS[call.tool] ?? call.tool}</span>
                {call.outcome === 'error' ? <Badge tone="warning">Failed</Badge> : null}
                <span className="text-xs text-muted">
                  <DateText value={call.at} withTime />
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-2">
            <ProblemNotice error={clear.error} />
            <div>
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} disabled={!online || clear.isPending} loading={clear.isPending} onClick={() => clear.mutate()}>
                Clear history
              </Button>
            </div>
          </div>
        </Disclosure>
      ) : (
        <p className="text-xs text-subtle">No activity recorded yet. Only the tool name, outcome, and time are kept; never what was read.</p>
      )}
    </li>
  )
}

function AppsPanel({ apps }: { apps: ConnectedApp[] }) {
  const online = useOnline()
  const [disconnecting, setDisconnecting] = useState<ConnectedApp | null>(null)
  const disconnect = useApiMutation<ConnectedApp, void>({
    mutationFn: (app) => api.connectedApps.revoke(app.id),
    success: (_r, app) => `${app.clientName} disconnected. It can no longer access your data.`,
    toastError: false,
    onSuccess: () => setDisconnecting(null),
  })
  return (
    <SettingsPanel title="Connected apps" description="AI assistants you've allowed to read your Wealthboard data over MCP. Only those marked Can make changes can add records.">
      <div className="flex flex-col gap-5">
        <McpAddress />
        {apps.length === 0 ? (
          <EmptyState compact icon={<PlugZap size={20} aria-hidden />} title="No connected apps">
            When you approve an assistant, it appears here so you can see what it reads and disconnect it.
          </EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-line" aria-label="Connected apps">
            {apps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                online={online}
                onDisconnect={(target) => {
                  disconnect.reset()
                  setDisconnecting(target)
                }}
              />
            ))}
          </ul>
        )}
        <div className="flex items-start gap-3 text-xs text-muted">
          <ShieldCheck size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" />
          <p>Connections are read-only unless you allowed changes, which only add transactions and valuations. They never include account numbers, private notes, passwords, or API keys. Unused connections expire after 30 days.</p>
        </div>
      </div>
      <ConfirmDialog
        open={!!disconnecting}
        onOpenChange={(o) => {
          if (!o && !disconnect.isPending) setDisconnecting(null)
        }}
        title={disconnecting ? `Disconnect ${disconnecting.clientName}?` : 'Disconnect app?'}
        description="It stops reading your data immediately. To use it again, connect it from the assistant and approve it here."
        confirmLabel="Disconnect"
        pending={disconnect.isPending}
        confirmDisabled={!online}
        onConfirm={() => {
          if (disconnecting && !disconnect.isPending) disconnect.mutate(disconnecting)
        }}
      >
        <ProblemNotice error={disconnect.error} />
      </ConfirmDialog>
    </SettingsPanel>
  )
}

export default function ConnectedAppsSettings() {
  usePageTitle('Connected apps')
  const { data, error, isPending, refetch } = useConnectedApps()
  return (
    <SettingsStack>
      {isPending ? (
        <ListSkeleton rows={2} />
      ) : error || !data ? (
        <div className="card">
          <ErrorState error={error} onRetry={() => void refetch()} title="Connected apps could not be loaded" />
        </div>
      ) : (
        <AppsPanel apps={data} />
      )}
    </SettingsStack>
  )
}
