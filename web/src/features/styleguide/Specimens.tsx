import { Archive, Download, Plus, Search, Wallet } from 'lucide-react'
import { useId, useState } from 'react'
import { ApiProblem } from '@/api/problem'
import { DateText, Delta, FreshnessBadge, Money, Percent, Bps, Quantity, RelativeDate, UnitPrice, Unavailable } from '@/components/format'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button, IconButton, type ButtonSize, type ButtonVariant } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { AmountField, ChoiceCards, DateField, SelectField, SwitchField, TextareaField, TextField } from '@/components/ui/Field'
import { Kbd } from '@/components/ui/Kbd'
import { Notice } from '@/components/ui/Notice'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/Skeleton'
import { TabsContent, TabsList, TabsRoot } from '@/components/ui/Tabs'
import { usePrefs } from '@/lib/prefs'
import { ChartSpecimens } from './ChartSpecimens'
import { Specimen, SpecimenGroup, Swatch } from './specimen'

const COLOR_GROUPS: { name: string; tokens: string[] }[] = [
  { name: 'Surfaces and lines', tokens: ['--bg', '--surface', '--surface-sunken', '--surface-raised', '--border', '--border-strong'] },
  { name: 'Text', tokens: ['--text', '--text-muted', '--text-subtle'] },
  { name: 'Accent', tokens: ['--accent', '--accent-strong', '--accent-soft', '--on-accent', '--focus-ring', '--gold'] },
  { name: 'Semantic', tokens: ['--positive', '--positive-soft', '--negative', '--negative-soft', '--warning', '--warning-soft', '--info', '--info-soft'] },
  { name: 'Chart', tokens: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8', '--chart-grid', '--chart-axis'] },
]

const TYPE_SCALE = [
  { token: '--fs-3xl', size: '44 / 48', use: 'Net-worth hero', display: true, sample: 'KES 12,353,918.00' },
  { token: '--fs-2xl', size: '34 / 40', use: 'Secondary hero', display: true, sample: 'Net worth' },
  { token: '--fs-xl', size: '26 / 32', use: 'Page title', display: true, sample: 'Accounts' },
  { token: '--fs-lg', size: '20 / 28', use: 'Section title', display: true, sample: 'Where your wealth sits' },
  { token: '--fs-md', size: '17 / 24', use: 'Card title', display: false, sample: 'Recent activity' },
  { token: '--fs-base', size: '15 / 22', use: 'Body', display: false, sample: 'Update this account’s value to keep your totals current.' },
  { token: '--fs-sm', size: '13 / 18', use: 'Captions, table meta', display: false, sample: 'As of 31 Oct 2026 · Zimele Asset Management' },
  { token: '--fs-xs', size: '12 / 16', use: 'Badges, axis ticks', display: false, sample: 'Stale · 40 days' },
]

const SPACING = [4, 8, 12, 16, 20, 24, 32, 40, 56, 72]
const RADII = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl']
const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'subtle', 'ghost', 'danger']
const SIZES: ButtonSize[] = ['sm', 'md', 'lg']
const TONES: Tone[] = ['neutral', 'accent', 'positive', 'negative', 'warning', 'info']

const DEMO_PROBLEM = new ApiProblem({ type: 'about:blank', title: 'Service unavailable', status: 503, detail: 'The server is starting up. Try again in a moment.' })

function FieldSpecimens() {
  const [kes, setKes] = useState('4576918.00')
  const [ugx, setUgx] = useState('1250000')
  const [kwd, setKwd] = useState('312.125')
  const [on, setOn] = useState(true)
  const [mode, setMode] = useState<'balance' | 'positions'>('balance')
  const modeName = useId()
  return (
    <>
      <Specimen label="Text, select, date, textarea">
        <div className="flex flex-col gap-4">
          <TextField label="Account name" placeholder="For example, Equity Bank Savings" hint="Shown everywhere this account appears." />
          <TextField label="Username" defaultValue="Amani K" error="Use only letters, numbers, dots, underscores, or hyphens" />
          <SelectField
            label="Category"
            defaultValue="fixed"
            options={[
              { value: 'fixed', label: 'Fixed income' },
              { value: 'mmf', label: 'Money market fund' },
            ]}
          />
          <DateField label="Effective date" defaultValue="2026-10-31" />
          <TextField label="Disabled" value="Read-only value" disabled readOnly />
          <TextareaField label="Notes" optional placeholder="Anything you want to remember" />
        </div>
      </Specimen>
      <Specimen label="AmountField: 2, 0, and 3 decimal currencies">
        <div className="flex flex-col gap-4">
          <AmountField label="Amount (KES, 2 decimals)" currency="KES" value={kes} onChange={setKes} />
          <AmountField label="Amount (UGX, 0 decimals)" currency="UGX" value={ugx} onChange={setUgx} />
          <AmountField label="Amount (KWD, 3 decimals)" currency="KWD" value={kwd} onChange={setKwd} />
          <AmountField label="With an error" currency="USD" value="" onChange={() => {}} error="Enter an amount greater than zero" />
          <div className="rounded-lg border border-line px-4 py-2">
            <SwitchField label="Liquid" description="Could become cash within a few days." checked={on} onCheckedChange={setOn} />
            <SwitchField label="Disabled switch" checked={false} onCheckedChange={() => {}} disabled />
          </div>
        </div>
      </Specimen>
      <Specimen label="ChoiceCards" wide>
        <ChoiceCards<'balance' | 'positions'>
          name={modeName}
          legend="How do you track this account?"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'balance', title: 'Value-tracked', description: 'One running value: savings, funds, land, vehicles, loans.', icon: <Wallet size={18} aria-hidden /> },
            { value: 'positions', title: 'Position-tracked', description: 'Cash plus holdings in stocks, ETFs, and funds.', icon: <Archive size={18} aria-hidden /> },
          ]}
        />
      </Specimen>
    </>
  )
}

function ControlSpecimens() {
  const [range, setRange] = useState('1y')
  return (
    <>
      <Specimen label="Segmented">
        <div className="flex flex-col items-start gap-3">
          <Segmented
            label="Range"
            value={range}
            onChange={setRange}
            options={['1m', '3m', '6m', '1y', 'all'].map((v) => ({ value: v, label: v === 'all' ? 'All' : v.toUpperCase() }))}
          />
          <Segmented label="Small" size="sm" value={range} onChange={setRange} options={['1m', '3m', '1y'].map((v) => ({ value: v, label: v.toUpperCase() }))} />
        </div>
      </Specimen>
      <Specimen label="Tabs">
        <TabsRoot defaultValue="overview">
          <TabsList
            label="Account sections"
            items={[
              { value: 'overview', label: 'Overview' },
              { value: 'activity', label: 'Activity', count: 42 },
              { value: 'valuations', label: 'Valuations', count: 12 },
            ]}
          />
          <TabsContent value="overview" className="pt-3 text-sm text-muted">
            Overview content.
          </TabsContent>
          <TabsContent value="activity" className="pt-3 text-sm text-muted">
            Activity content.
          </TabsContent>
          <TabsContent value="valuations" className="pt-3 text-sm text-muted">
            Valuations content.
          </TabsContent>
        </TabsRoot>
      </Specimen>
    </>
  )
}

export function Specimens({ refreshKey }: { refreshKey: string }) {
  const { today } = usePrefs()
  return (
    <div className="flex flex-col gap-10">
      <SpecimenGroup title="Colour tokens" description="Read live from CSS variables. Components and charts use these tokens only.">
        {COLOR_GROUPS.map((g) => (
          <Specimen key={g.name} label={g.name} wide={g.tokens.length > 6}>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
              {g.tokens.map((t) => (
                <Swatch key={t} token={t} refreshKey={refreshKey} />
              ))}
            </div>
          </Specimen>
        ))}
      </SpecimenGroup>

      <SpecimenGroup title="Typography" description="Fraunces for titles and hero figures; Inter for everything else. Every figure uses tabular, lining numerals.">
        <Specimen label="Type scale" wide>
          <ul className="flex flex-col divide-y divide-line">
            {TYPE_SCALE.map((t) => (
              <li key={t.token} className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-baseline sm:gap-4">
                <span className="text-xs text-muted">
                  <span className="font-mono text-ink">{t.token}</span> · {t.size} · {t.use}
                </span>
                <span className={t.display ? 'display num min-w-0 truncate text-ink' : 'num min-w-0 truncate text-ink'} style={{ fontSize: `var(${t.token})` }}>
                  {t.sample}
                </span>
              </li>
            ))}
          </ul>
        </Specimen>
      </SpecimenGroup>

      <SpecimenGroup title="Space, radius, and elevation">
        <Specimen label="Spacing (4 px base)">
          <ul className="flex flex-col gap-1.5">
            {SPACING.map((s) => (
              <li key={s} className="flex items-center gap-3">
                <span className="num w-8 text-right text-xs text-muted">{s}</span>
                <span className="h-3 rounded-sm bg-accent/70" style={{ width: s * 2 }} />
              </li>
            ))}
          </ul>
        </Specimen>
        <Specimen label="Radii and elevation">
          <div className="flex flex-wrap gap-3">
            {RADII.map((r) => (
              <div key={r} className="grid size-20 place-items-center border border-line-strong/60 bg-sunken text-[11px] font-mono text-muted" style={{ borderRadius: `var(${r})` }}>
                {r.replace('--radius-', '')}
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-4">
            {['shadow-e1', 'shadow-e2', 'shadow-e3'].map((e) => (
              <div key={e} className={`grid h-16 w-24 place-items-center rounded-lg border border-line bg-surface font-mono text-[11px] text-muted ${e}`}>
                {e.replace('shadow-', '')}
              </div>
            ))}
          </div>
        </Specimen>
      </SpecimenGroup>

      <SpecimenGroup title="Buttons">
        <Specimen label="Variants and sizes" wide>
          <div className="flex flex-col gap-3">
            {SIZES.map((size) => (
              <div key={size} className="flex flex-wrap items-center gap-2">
                <span className="w-8 font-mono text-xs text-muted">{size}</span>
                {VARIANTS.map((v) => (
                  <Button key={v} variant={v} size={size}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen label="States">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Plus size={16} aria-hidden />}>
              With icon
            </Button>
            <Button variant="primary" loading>
              Saving
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
            <Button variant="danger" loading>
              Deleting
            </Button>
          </div>
        </Specimen>
        <Specimen label="Icon buttons and keys">
          <div className="flex flex-wrap items-center gap-2">
            <IconButton label="Search" icon={<Search size={18} aria-hidden />} shortcut="/" />
            <IconButton label="Download" variant="secondary" icon={<Download size={18} aria-hidden />} />
            <IconButton label="Add" variant="primary" icon={<Plus size={18} aria-hidden />} />
            <IconButton label="Archive (disabled)" icon={<Archive size={18} aria-hidden />} disabled />
            <span className="ml-2 inline-flex items-center gap-1 text-sm text-muted">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </div>
        </Specimen>
      </SpecimenGroup>

      <SpecimenGroup title="Badges and notices">
        <Specimen label="Badges">
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <Badge key={t} tone={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Badge>
            ))}
          </div>
        </Specimen>
        <Specimen label="Progress">
          <div className="flex flex-col gap-3">
            <ProgressBar percent="62.5" label="On track" />
            <ProgressBar percent="38" tone="warning" label="Behind plan" />
            <ProgressBar percent="100" tone="positive" label="Completed" />
            <ProgressBar percent="40" incomplete label="Incomplete" />
          </div>
        </Specimen>
        <Specimen label="Notices" wide>
          <div className="flex flex-col gap-2.5">
            <Notice tone="warning" title="USD → KES rate missing" action={<Button size="sm">Add rate</Button>}>
              Interactive Brokers Brokerage can’t be converted, so your total is incomplete.
            </Notice>
            <Notice tone="info" title="Values are hidden">
              Press Shift H to show amounts again.
            </Notice>
            <Notice tone="positive" title="Import finished">
              24 transactions added; 3 duplicates skipped.
            </Notice>
            <Notice tone="negative" title="Sell exceeds holdings">
              You hold 40 VWRA. Enter 40 or fewer.
            </Notice>
          </div>
        </Specimen>
      </SpecimenGroup>

      <SpecimenGroup title="Fields">
        <FieldSpecimens />
      </SpecimenGroup>

      <SpecimenGroup title="Selection and navigation">
        <ControlSpecimens />
      </SpecimenGroup>

      <SpecimenGroup title="Figures" description="Money, changes, quantities, and dates always render through the format components, which also handle privacy masking.">
        <Specimen label="Money and changes" wide>
          <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
            <dt className="text-muted">Positive</dt>
            <dd>
              <Money minor="457691800" currency="KES" />
            </dd>
            <dt className="text-muted">Negative</dt>
            <dd>
              <Money minor="-1450000" currency="KES" />
            </dd>
            <dt className="text-muted">0 decimals (UGX)</dt>
            <dd>
              <Money minor="1250000" currency="UGX" />
            </dd>
            <dt className="text-muted">3 decimals (KWD)</dt>
            <dd>
              <Money minor="312125" currency="KWD" />
            </dd>
            <dt className="text-muted">Beyond 2^53</dt>
            <dd className="min-w-0 break-all">
              <Money minor="123456789012345678901" currency="KES" />
            </dd>
            <dt className="text-muted">Compact (charts, badges)</dt>
            <dd>
              <Money minor="1235391800" currency="KES" compact />
            </dd>
            <dt className="text-muted">Change: gain, loss</dt>
            <dd className="flex flex-wrap gap-4">
              <Delta minor="12040000" currency="KES" suffix="this month" />
              <Delta minor="-3500000" currency="KES" />
            </dd>
            <dt className="text-muted">Liability (a decrease is good)</dt>
            <dd>
              <Delta minor="-2400000" currency="KES" invert />
            </dd>
            <dt className="text-muted">No history</dt>
            <dd>
              <Delta minor={null} currency="KES" />
            </dd>
            <dt className="text-muted">Missing rate</dt>
            <dd>
              <Money minor={null} currency="KES" unavailable={<Unavailable reason="No USD → KES rate on this date" />} />
            </dd>
          </dl>
        </Specimen>
        <Specimen label="Quantities, prices, rates, dates">
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-muted">Quantity</dt>
            <dd>
              <Quantity value="40.125" />
            </dd>
            <dt className="text-muted">Unit price</dt>
            <dd>
              <UnitPrice value="100.00" currency="USD" />
            </dd>
            <dt className="text-muted">No price</dt>
            <dd>
              <UnitPrice value={null} currency="KES" />
            </dd>
            <dt className="text-muted">Percent</dt>
            <dd>
              <Percent value="62.48" />
            </dd>
            <dt className="text-muted">Basis points</dt>
            <dd>
              <Bps value={825} />
            </dd>
            <dt className="text-muted">Date</dt>
            <dd>
              <DateText value={today} />
            </dd>
            <dt className="text-muted">Relative</dt>
            <dd>
              <RelativeDate value={today} />
            </dd>
          </dl>
        </Specimen>
        <Specimen label="Freshness">
          <div className="flex flex-wrap gap-2">
            <FreshnessBadge freshness="fresh" asOf={today} />
            <FreshnessBadge freshness="stale" asOf="2026-09-23" />
            <FreshnessBadge freshness="missing" />
            <Unavailable />
          </div>
        </Specimen>
      </SpecimenGroup>

      <SpecimenGroup title="States">
        <Specimen label="Empty state">
          <EmptyState compact icon={<Wallet size={20} aria-hidden />} title="No accounts yet" action={<Button variant="primary">Add an account</Button>}>
            Add a savings account, fund, or property to see your net worth.
          </EmptyState>
        </Specimen>
        <Specimen label="Error state">
          <ErrorState compact error={DEMO_PROBLEM} onRetry={() => {}} />
        </Specimen>
        <Specimen label="Skeletons" wide>
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-md" />
            <div className="flex-1">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-28" />
          </div>
          <Skeleton className="mt-4 h-28" />
        </Specimen>
      </SpecimenGroup>

      <ChartSpecimens />
    </div>
  )
}
