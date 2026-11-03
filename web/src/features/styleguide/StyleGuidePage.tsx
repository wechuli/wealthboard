import { Columns2, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/cn'
import { useTheme } from '@/lib/theme-context'
import type { ResolvedTheme } from '@/lib/theme'
import { usePageTitle } from '@/lib/usePageTitle'
import { SCOPED_TOKENS } from './scoped-tokens'
import { Specimens } from './Specimens'

const THEME_NAME: Record<ResolvedTheme, string> = { light: 'Paper (light)', dark: 'Night ledger (dark)' }

function PanelLabel({ theme, note }: { theme: ResolvedTheme; note: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {theme === 'dark' ? <Moon size={16} aria-hidden className="text-muted" /> : <Sun size={16} aria-hidden className="text-muted" />}
      <p className="text-sm font-semibold text-ink">{THEME_NAME[theme]}</p>
      <Badge tone="neutral">{note}</Badge>
    </div>
  )
}

/** Dev-only living style guide: tokens, components, states, and chart samples in both themes. */
export default function StyleGuidePage() {
  usePageTitle('Style guide')
  const { resolved } = useTheme()
  const other: ResolvedTheme = resolved === 'dark' ? 'light' : 'dark'
  const [compare, setCompare] = useState(false)

  return (
    <div className={cn('page', compare && 'max-w-[1680px]')}>
      {/* Scoped copies of the theme tokens so a second theme can render beside the current one. */}
      <style>{SCOPED_TOKENS}</style>
      <PageHeader
        title="Style guide"
        description="The Quiet Ledger system as built: live tokens, components, states, and chart samples. Development builds only."
        actions={
          <Button variant={compare ? 'subtle' : 'secondary'} icon={<Columns2 size={16} aria-hidden />} aria-pressed={compare} onClick={() => setCompare((v) => !v)}>
            {compare ? 'Show one theme' : 'Show both themes'}
          </Button>
        }
      />
      {compare ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-line bg-canvas p-4 md:p-5">
            <PanelLabel theme={resolved} note="Current" />
            <Specimens refreshKey={`${resolved}-a`} />
          </div>
          <div data-theme={other} className={cn(`sg-${other}`, 'min-w-0 rounded-xl border border-line bg-canvas p-4 text-ink md:p-5')}>
            <PanelLabel theme={other} note="Scoped preview" />
            <Specimens refreshKey={`${resolved}-b`} />
          </div>
        </div>
      ) : (
        <Specimens refreshKey={resolved} />
      )}
    </div>
  )
}
