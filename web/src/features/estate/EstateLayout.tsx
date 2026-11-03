import { NavLink, Outlet } from 'react-router'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/cn'
import { useEstate } from '@/lib/queries'

const SECTIONS = [
  { to: '/estate', label: 'Overview', end: true },
  { to: '/estate/beneficiaries', label: 'Beneficiaries', end: false },
  { to: '/estate/distribution', label: 'Distribution', end: false },
  { to: '/estate/summary', label: 'Summary', end: false },
]

/** Estate planning: one header, the planning-aid notice, an in-page section nav, then the section. */
export default function EstateLayout() {
  const { data } = useEstate()
  const valuesIncomplete = data ? !data.currentValuesComplete : false
  const warning = data?.currentValuesWarning.trim().replace(/\.$/, '')
  return (
    <div className="page">
      <PageHeader title="Estate planning" description="Record who should receive what, how each asset is held, and keep dated summaries to review with an adviser." />
      <Notice tone="info" title="A planning aid, not a will" className="mb-6">
        <p>
          This records your intentions privately. It does not transfer ownership, register provider beneficiaries, or replace locally valid legal documents.
          {valuesIncomplete ? ` Current values are indicative and may be incomplete${warning ? `. ${warning}` : ''}.` : null}
        </p>
      </Notice>
      <nav aria-label="Estate planning sections" className="scroll-x -mx-4 mb-6 px-4 md:mx-0 md:mb-8 md:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {SECTIONS.map((s) => (
            <li key={s.to}>
              <NavLink
                to={s.to}
                end={s.end}
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors duration-[var(--dur-1)] md:h-10',
                    isActive ? 'border-accent text-ink' : 'border-transparent text-muted hover:border-line-strong hover:text-ink',
                  )
                }
              >
                {s.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  )
}
