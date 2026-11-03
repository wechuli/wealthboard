import { NavLink, Outlet } from 'react-router'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/cn'
import { INSIGHT_SECTIONS } from '@/features/shell/nav'

/** Insights: one header, an in-page section nav (scrolls sideways on phones), then the section. */
export default function InsightsLayout() {
  return (
    <div className="page">
      <PageHeader title="Insights" description="How your wealth has moved, where it sits, what it earns, and how your accounts compare." />
      <nav aria-label="Insights sections" className="scroll-x -mx-4 mb-6 px-4 md:mx-0 md:mb-8 md:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {INSIGHT_SECTIONS.map((s) => (
            <li key={s.to}>
              <NavLink
                to={s.to}
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
