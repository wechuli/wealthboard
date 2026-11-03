import { Monitor, Moon, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from '@/components/ui/Button'
import { APP_NAME } from '@/config'
import { useTheme } from '@/lib/theme-context'
import type { ThemePreference } from '@/lib/theme'
import { BrandMark } from '@/features/shell/Brand'

const NEXT_THEME: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Paper (light)', dark: 'Night ledger (dark)' }

function ThemeToggle() {
  const { preference, setPreference } = useTheme()
  const Icon = preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor
  return (
    <IconButton
      label={`Appearance: ${THEME_LABEL[preference]}. Switch to ${THEME_LABEL[NEXT_THEME[preference]]}`}
      icon={<Icon size={18} aria-hidden />}
      onClick={() => setPreference(NEXT_THEME[preference])}
    />
  )
}

/**
 * The ledger motif: ruled paper, a double margin rule, entries sketched as quiet bars, and a rising
 * line that ends in the brand's brass dot. Drawn entirely from theme tokens.
 */
function LedgerMotif({ className }: { className?: string }) {
  const rows = Array.from({ length: 11 }, (_, i) => 24 + i * 30)
  const entries = [62, 44, 78, 52, 70, 38, 84, 58, 66, 48]
  const points: [number, number][] = [
    [96, 286],
    [148, 262],
    [196, 270],
    [248, 226],
    [300, 236],
    [352, 186],
    [404, 172],
    [452, 118],
  ]
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
  const area = `${path} L452 324 L96 324 Z`
  const last = points.at(-1)!
  return (
    <svg viewBox="0 0 520 340" className={className} aria-hidden preserveAspectRatio="xMidYMid meet">
      {rows.map((y) => (
        <line key={y} x1="0" x2="520" y1={y} y2={y} style={{ stroke: 'var(--border)' }} strokeWidth="1" />
      ))}
      <line x1="64" x2="64" y1="0" y2="340" style={{ stroke: 'var(--accent)' }} strokeOpacity="0.24" strokeWidth="1" />
      <line x1="69" x2="69" y1="0" y2="340" style={{ stroke: 'var(--accent)' }} strokeOpacity="0.24" strokeWidth="1" />
      {entries.map((w, i) => (
        <rect key={i} x={480 - w * 0.5} y={rows[i]! + 9} width={w * 0.5} height="5" rx="2.5" style={{ fill: 'var(--border-strong)' }} fillOpacity="0.22" />
      ))}
      {entries.slice(0, 9).map((w, i) => (
        <rect key={`l${i}`} x="16" y={rows[i]! + 9} width={Math.round(w * 0.42)} height="5" rx="2.5" style={{ fill: 'var(--border-strong)' }} fillOpacity="0.16" />
      ))}
      <path d={area} style={{ fill: 'var(--chart-area-top)' }} />
      <path d={path} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.slice(0, -1).map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="3.5" style={{ fill: 'var(--surface)', stroke: 'var(--accent)' }} strokeWidth="1.75" />
      ))}
      <circle cx={last[0]} cy={last[1]} r="11" style={{ fill: 'var(--gold)' }} fillOpacity="0.18" />
      <circle cx={last[0]} cy={last[1]} r="6" style={{ fill: 'var(--gold)' }} />
    </svg>
  )
}

const FACTS = ['Self-hosted. Your figures stay on your server.', 'No bank logins, trackers, or ads.', 'Exact to the last cent, in every currency.']

/** Calm split layout for sign-in and sign-up: the brand story on the left (desktop), the form on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside
        className="relative hidden flex-col justify-between overflow-hidden border-r border-line px-12 py-10 lg:flex xl:px-16"
        style={{ backgroundColor: 'color-mix(in oklab, var(--surface-sunken) 70%, var(--bg))' }}
      >
        <div className="flex items-center gap-3">
          <BrandMark size={34} />
          <span className="display text-[1.375rem] font-medium tracking-[-0.01em] text-ink">{APP_NAME}</span>
        </div>
        <div className="max-w-[34rem]">
          <p className="display text-[2.75rem] leading-[1.08] text-ink xl:text-[3.25rem]">Your wealth, privately tracked.</p>
          <p className="mt-4 max-w-[42ch] text-md text-muted">One quiet ledger for every account, asset, and goal, kept on a server you control.</p>
          <LedgerMotif className="mt-10 w-full max-w-[32rem]" />
        </div>
        <ul className="grid grid-cols-3 gap-6 border-t border-line pt-5 text-sm text-muted">
          {FACTS.map((f) => (
            <li key={f} className="max-w-[22ch]">
              {f}
            </li>
          ))}
        </ul>
      </aside>
      <div className="relative flex min-h-dvh flex-col">
        <div className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] md:right-5 md:top-5">
          <ThemeToggle />
        </div>
        <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 pb-10 pt-16 sm:px-6 lg:py-12">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <BrandMark size={40} />
            <p className="display mt-3 text-[1.375rem] font-medium text-ink">{APP_NAME}</p>
            <p className="mt-1 text-sm text-muted">Your wealth, privately tracked.</p>
          </div>
          <div className="w-full max-w-[25.5rem]">{children}</div>
        </main>
      </div>
    </div>
  )
}

/** The form card. The heading is the page's h1. */
export function AuthCard({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <div className="card px-5 py-6 shadow-e2 sm:px-7 sm:py-8">
        <h1 className="display text-[1.75rem] leading-9 text-ink">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
      {footer ? <div className="mt-5 text-center text-sm text-muted">{footer}</div> : null}
    </>
  )
}
