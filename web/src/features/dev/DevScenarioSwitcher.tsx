import { useQueryClient } from '@tanstack/react-query'
import { FlaskConical, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AUTH_SCENARIOS, DATA_SCENARIOS, getScenario, setScenario, type AuthScenario, type DataScenario } from '@/api/mock/scenario'
import { DEMO_PASSWORD } from '@/api/mock/adapter'
import { DATA_SOURCE_KIND } from '@/api'
import { cn } from '@/lib/cn'
import { Segmented } from '@/components/ui/Segmented'

/**
 * Dev-only mock scenario switcher. Rendered only when import.meta.env.DEV, so the whole module is
 * tree-shaken from production builds.
 */
export function DevScenarioSwitcher() {
  const [open, setOpen] = useState(false)
  const [s, setS] = useState(getScenario)
  const qc = useQueryClient()
  const navigate = useNavigate()
  if (DATA_SOURCE_KIND !== 'mock') return null
  const apply = (next: Partial<typeof s>) => {
    const merged = setScenario(next)
    setS(merged)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'u' })
    void qc.invalidateQueries()
    if (next.auth) navigate('/')
  }
  return (
    <div className="fixed bottom-[calc(var(--bottombar-h)+env(safe-area-inset-bottom)+12px)] left-3 z-40 md:bottom-4 md:left-auto md:right-4" data-no-print>
      {open ? (
        <div className="w-[min(340px,calc(100vw-24px))] rounded-xl border border-line bg-raised p-4 shadow-e3" role="dialog" aria-label="Mock scenarios">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Mock scenario</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close scenario switcher" className="grid size-9 place-items-center rounded-md text-muted hover:bg-sunken">
              <X size={16} aria-hidden />
            </button>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">Data</legend>
            {DATA_SCENARIOS.map((d) => (
              <div key={d.id} className={cn('flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-sunken', s.data === d.id && 'bg-accent-soft')}>
                <input id={`wb-scenario-${d.id}`} type="radio" name="wb-scenario" className="mt-1 accent-[var(--accent)]" checked={s.data === d.id} onChange={() => apply({ data: d.id as DataScenario })} />
                <label htmlFor={`wb-scenario-${d.id}`} className="cursor-pointer">
                  <span className="block text-sm font-medium text-ink">{d.label}</span>
                  <span className="block text-xs text-muted">{d.hint}</span>
                </label>
              </div>
            ))}
          </fieldset>
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 text-xs font-medium text-subtle">Auth mode</p>
            <Segmented<AuthScenario> size="sm" label="Auth mode" value={s.auth} onChange={(auth) => apply({ auth })} options={AUTH_SCENARIOS.map((a) => ({ value: a.id, label: a.label }))} />
            <p className="mt-2 text-xs text-muted">
              Demo sign-in: <code className="rounded bg-sunken px-1">amani</code> / <code className="rounded bg-sunken px-1">{DEMO_PASSWORD}</code>
            </p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-10 items-center gap-2 rounded-full border border-line bg-raised px-3.5 text-xs font-medium text-muted shadow-e2 hover:text-ink"
          aria-label="Open mock scenario switcher"
        >
          <FlaskConical size={15} aria-hidden />
          {DATA_SCENARIOS.find((d) => d.id === s.data)?.label}
        </button>
      )}
    </div>
  )
}
