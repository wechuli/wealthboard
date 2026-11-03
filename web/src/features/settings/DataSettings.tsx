import { useMutation } from '@tanstack/react-query'
import { Check, Download, FileJson, FileSpreadsheet, FileUp, RotateCcw, X } from 'lucide-react'
import { useId, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api, DATA_SOURCE_KIND } from '@/api'
import { API_BASE } from '@/api/http/httpAdapter'
import { ApiProblem, problemMessage } from '@/api/problem'
import type { RestoreSummary, UserArchive } from '@/api/types'
import { DateText } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/lib/cn'
import { formatDecimal } from '@/lib/money'
import { isOnline, OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useApiMutation } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { ProblemNotice, SettingsPanel, SettingsStack } from './settings-kit'

// ---- downloads -------------------------------------------------------------------

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

type ExportKind = 'json' | 'transactions' | 'accounts'

/**
 * The full-portfolio export, byte for byte as the server produced it, so a restore receives exactly
 * what was exported (large integer amounts never pass through a JavaScript number). The mock has no
 * file, so its archive object is serialised instead.
 */
async function userArchiveBlob(): Promise<Blob> {
  if (DATA_SOURCE_KIND !== 'http') return new Blob([JSON.stringify(await api.exports.userArchive(), null, 2)], { type: 'application/json' })
  let response: Response
  try {
    response = await fetch(`${API_BASE}/exports/user`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } })
  } catch {
    throw new ApiProblem({ type: 'about:blank', title: 'Offline', status: 0, detail: 'The server could not be reached. Check your connection.' })
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { title?: string; detail?: string } | null
    throw new ApiProblem({ type: 'about:blank', title: body?.title ?? 'Export failed', status: response.status, detail: body?.detail ?? `The server responded with ${response.status}.` })
  }
  return new Blob([await response.arrayBuffer()], { type: 'application/json' })
}

function exportFilename(kind: ExportKind, today: string): string {
  if (kind === 'json') return `wealthboard-export-${today}.json`
  return `wealthboard-${kind}-${today}.csv`
}

/** Fetches an export from the server and saves it. Reads, but it needs the server, so it is blocked offline. */
function useExport() {
  const { today } = usePrefs()
  return useMutation<string, Error, ExportKind>({
    mutationFn: async (kind) => {
      if (!isOnline()) throw new ApiProblem({ type: 'about:blank', title: 'Offline', status: 0, detail: OFFLINE_REASON })
      const filename = exportFilename(kind, today)
      if (kind === 'json') {
        downloadBlob(await userArchiveBlob(), filename)
      } else {
        const csv = kind === 'transactions' ? await api.exports.transactionsCsv() : await api.exports.accountsCsv()
        downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
      }
      return filename
    },
    onSuccess: (filename) => toast.success('Export ready', { description: `Saved ${filename} to your downloads.` }),
    onError: (err) => toast.error(ApiProblem.is(err) ? err.title : 'Export failed', { description: problemMessage(err) }),
  })
}

function ExportRow({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4 first:pt-0 last:pb-0">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-sunken text-muted">{icon}</span>
      <div className="min-w-0 flex-1 basis-56">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-0.5 text-sm text-muted">{children}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  )
}

function ExportPanel() {
  const online = useOnline()
  const exp = useExport()
  const btn = (kind: ExportKind, label: string) => (
    <Button
      variant="secondary"
      icon={<Download size={16} aria-hidden />}
      loading={exp.isPending && exp.variables === kind}
      disabled={!online || exp.isPending}
      title={!online ? OFFLINE_REASON : undefined}
      onClick={() => exp.mutate(kind)}
    >
      {label}
    </Button>
  )
  return (
    <SettingsPanel title="Export" description="Download your data at any time. Files are generated by your server and saved straight to this device.">
      <ul className="flex flex-col divide-y divide-line">
        <ExportRow icon={<FileJson size={20} aria-hidden />} title="Full portfolio (JSON)" action={btn('json', 'Export JSON')}>
          Everything needed to restore: settings, categories, institutions, accounts, transactions, valuations, rates, goals, instruments, and prices. Passwords are never included.
        </ExportRow>
        <ExportRow icon={<FileSpreadsheet size={20} aria-hidden />} title="Transactions (CSV)" action={btn('transactions', 'Export CSV')}>
          Every deposit, withdrawal, income, fee, and transfer, one per row, for spreadsheets.
        </ExportRow>
        <ExportRow icon={<FileSpreadsheet size={20} aria-hidden />} title="Accounts (CSV)" action={btn('accounts', 'Export CSV')}>
          Each account with its category, institution, currency, and current value.
        </ExportRow>
      </ul>
      {!online ? <p className="mt-4 text-xs text-warning">{OFFLINE_REASON}</p> : null}
    </SettingsPanel>
  )
}

// ---- restore ---------------------------------------------------------------------

const COLLECTIONS: { key: Exclude<keyof UserArchive, 'format' | 'version' | 'exportedAt' | 'settings'>; label: string; primary?: boolean }[] = [
  { key: 'accounts', label: 'Accounts', primary: true },
  { key: 'transactions', label: 'Transactions', primary: true },
  { key: 'valuations', label: 'Valuations', primary: true },
  { key: 'goals', label: 'Goals', primary: true },
  { key: 'investmentInstruments', label: 'Instruments', primary: true },
  { key: 'securityPrices', label: 'Prices', primary: true },
  { key: 'categories', label: 'Categories' },
  { key: 'institutions', label: 'Institutions' },
  { key: 'exchangeRates', label: 'Exchange rates' },
  { key: 'positionEvents', label: 'Trades and position events' },
  { key: 'positionReconciliations', label: 'Reconciliations' },
  { key: 'accountConversions', label: 'Account conversions' },
  { key: 'goalContributionPlans', label: 'Goal plans' },
  { key: 'goalMilestones', label: 'Goal milestones' },
  { key: 'goalAlertDismissals', label: 'Dismissed reminders' },
  { key: 'beneficiaries', label: 'Beneficiaries' },
  { key: 'estatePlans', label: 'Estate plans' },
  { key: 'estateAccountDirectives', label: 'Estate directives' },
  { key: 'estateAllocations', label: 'Estate allocations' },
  { key: 'estateResiduaryAllocations', label: 'Residual allocations' },
  { key: 'estatePlanSnapshots', label: 'Estate snapshots' },
]

/** The server rejects archives above 25 MB. */
const MAX_BYTES = 25 * 1024 * 1024
/** Exports from the server say "wealthboard-user-json"; the API contract (and the mock) say "wealthboard-user-export". */
const ARCHIVE_FORMATS = new Set(['wealthboard-user-json', 'wealthboard-user-export'])

interface LoadedFile {
  file: File
  archive: UserArchive
}

/** Older export versions lack some collections; the server upgrades them, so they count as empty here. */
function countOf(archive: UserArchive, key: (typeof COLLECTIONS)[number]['key']): number {
  const value: unknown = archive[key]
  return Array.isArray(value) ? value.length : 0
}

function parseArchive(text: string): UserArchive {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file isn’t valid JSON. Choose the .json file you exported from Wealthboard.')
  }
  if (!data || typeof data !== 'object') throw new Error('This file doesn’t look like a portfolio export.')
  const d = data as Record<string, unknown>
  if (typeof d.format !== 'string' || !ARCHIVE_FORMATS.has(d.format)) throw new Error('This file isn’t a Wealthboard portfolio export. Choose a file created with “Export JSON”.')
  if (typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 2) throw new Error('This export’s format version isn’t supported. Export again from the Wealthboard that created it.')
  if (typeof d.settings !== 'object' || d.settings === null) throw new Error('This export is missing its settings.')
  const wrong = COLLECTIONS.filter((c) => d[c.key] !== undefined && !Array.isArray(d[c.key])).map((c) => c.label.toLowerCase())
  if (wrong.length > 0) throw new Error(`This export looks damaged: ${wrong.slice(0, 3).join(', ')}${wrong.length > 3 ? ', and more' : ''} can’t be read.`)
  return data as UserArchive
}

const count = (n: number) => formatDecimal(String(n))

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${formatDecimal(String(Math.round(bytes / 102.4) / 10))} KB`
  return `${formatDecimal(String(Math.round(bytes / (1024 * 102.4)) / 10))} MB`
}

function ArchiveSummary({ file, onClear }: { file: LoadedFile; onClear(): void }) {
  const a = file.archive
  const primary = COLLECTIONS.filter((c) => c.primary)
  const rest = COLLECTIONS.filter((c) => !c.primary && countOf(a, c.key) > 0)
  const base = typeof a.settings.baseCurrency === 'string' ? a.settings.baseCurrency : null
  return (
    <div className="rounded-lg border border-line bg-sunken/40">
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
        <FileJson size={20} aria-hidden className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{file.file.name}</p>
          <p className="text-xs text-muted">
            Exported <DateText value={a.exportedAt} withTime /> · {fileSize(file.file.size)} · format version {String(a.version)}
            {base ? ` · base currency ${base}` : ''}
          </p>
        </div>
        <Button size="sm" variant="ghost" icon={<X size={15} aria-hidden />} onClick={onClear}>
          Choose another
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
        {primary.map((c) => (
          <div key={c.key} className="bg-surface px-4 py-3">
            <dt className="text-xs text-muted">{c.label}</dt>
            <dd className={cn('num mt-0.5 text-lg font-semibold', countOf(a, c.key) ? 'text-ink' : 'text-subtle')}>{count(countOf(a, c.key))}</dd>
          </div>
        ))}
      </dl>
      {rest.length > 0 ? (
        <dl className="flex flex-wrap gap-x-5 gap-y-1.5 px-4 py-3 text-xs">
          {rest.map((c) => (
            <div key={c.key} className="flex items-baseline gap-1.5">
              <dt className="text-muted">{c.label}</dt>
              <dd className="num font-medium text-ink">{count(countOf(a, c.key))}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

function restoreToast(s: RestoreSummary): string {
  const parts = [`${count(s.accounts)} accounts`, `${count(s.transactions)} transactions`, `${count(s.goals)} goals`]
  if (s.investmentInstruments) parts.push(`${count(s.investmentInstruments)} instruments`)
  return `Portfolio restored: ${parts.join(', ')}`
}

function RestorePanel() {
  const online = useOnline()
  const inputId = useId()
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const exp = useExport()
  const [exportedFirst, setExportedFirst] = useState<string | null>(null)

  const restore = useApiMutation({
    // Uploads the chosen file itself (multipart), exactly as exported; the server validates and upgrades it.
    mutationFn: (f: File) => api.exports.restoreFile(f),
    success: (s) => restoreToast(s),
    toastError: false,
    onSuccess: () => {
      setConfirmOpen(false)
      setFile(null)
      setTyped('')
      setExportedFirst(null)
    },
  })

  const load = async (f: File | undefined) => {
    setReadError(null)
    setFile(null)
    if (!f) return
    if (f.size > MAX_BYTES) {
      setReadError('This file is larger than 25 MB, the most the server accepts. Portfolio exports are usually much smaller; check you chose the right file.')
      return
    }
    try {
      const archive = parseArchive(await f.text())
      setFile({ file: f, archive })
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'The file could not be read.')
    }
  }

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    void load(e.target.files?.[0])
    e.target.value = ''
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void load(e.dataTransfer.files[0])
  }

  const openConfirm = () => {
    setTyped('')
    setExportedFirst(null)
    restore.reset()
    setConfirmOpen(true)
  }

  const confirmed = typed.trim() === 'REPLACE'

  return (
    <SettingsPanel title="Restore from a backup" description="Load a full-portfolio JSON export to bring back a previous state or move to a new server.">
      <div className="flex flex-col gap-4">
        {!file ? (
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault()
              if (!dragging) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-9 text-center transition-colors duration-[var(--dur-1)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]',
              dragging ? 'border-accent bg-accent-soft/50' : 'border-line-strong/60 bg-sunken/40 hover:border-line-strong hover:bg-sunken/70',
            )}
          >
            <input id={inputId} type="file" accept=".json,application/json" onChange={onPick} className="sr-only" />
            <span className="grid size-11 place-items-center rounded-full bg-surface text-muted shadow-e1">
              <FileUp size={20} aria-hidden />
            </span>
            <span className="text-sm font-medium text-ink">Choose an export file, or drop it here</span>
            <span className="text-xs text-muted">A .json file created with Export JSON. Nothing changes until you confirm.</span>
          </label>
        ) : (
          <ArchiveSummary file={file} onClear={() => setFile(null)} />
        )}
        {readError ? (
          <Notice tone="negative" role="alert" title="This file can’t be restored">
            {readError}
          </Notice>
        ) : null}
        {file ? (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <p className="mr-auto text-xs text-muted">{online ? 'Restoring replaces everything shown above for your profile only.' : OFFLINE_REASON}</p>
            <Button variant="danger" icon={<RotateCcw size={16} aria-hidden />} onClick={openConfirm} disabled={!online}>
              Restore this backup
            </Button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!restore.isPending) setConfirmOpen(o)
        }}
        title="This replaces your entire portfolio"
        description={file ? `Every account, transaction, valuation, goal, and setting will be replaced with the contents of ${file.file.name}. This can’t be undone.` : undefined}
        confirmLabel="Replace portfolio"
        pending={restore.isPending}
        confirmDisabled={!confirmed || !online}
        onConfirm={() => {
          if (file && confirmed && !restore.isPending) restore.mutate(file.file)
        }}
      >
        <div className="flex flex-col gap-4">
          <ProblemNotice error={restore.error} />
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-sunken/50 px-3.5 py-3">
            <div className="min-w-0 flex-1 basis-48 text-sm">
              <p className="font-medium text-ink">Keep a copy of what you have now</p>
              <p className="text-xs text-muted">{exportedFirst ? `Saved ${exportedFirst}.` : 'Download your current portfolio before replacing it.'}</p>
            </div>
            {exportedFirst ? (
              <Badge tone="positive" icon={<Check size={12} aria-hidden />}>
                Exported
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                icon={<Download size={14} aria-hidden />}
                loading={exp.isPending}
                disabled={!online}
                onClick={() => exp.mutate('json', { onSuccess: (name) => setExportedFirst(name) })}
              >
                Export current portfolio first
              </Button>
            )}
          </div>
          <TextField
            label={
              <>
                Type <span className="num rounded-sm bg-sunken px-1 font-semibold tracking-wider">REPLACE</span> to confirm
              </>
            }
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      </ConfirmDialog>
    </SettingsPanel>
  )
}

export default function DataSettings() {
  usePageTitle('Export and restore')
  return (
    <SettingsStack>
      <ExportPanel />
      <RestorePanel />
    </SettingsStack>
  )
}
