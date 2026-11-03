import { ArrowRight, FileSpreadsheet, Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { usePrefs } from '@/lib/prefs'
import { useSession } from '@/lib/session'

const STEPS = [
  {
    title: 'Add what you own and owe',
    body: 'Savings, money-market and fixed-income funds, land, a vehicle, a brokerage account, or a loan. Each one is an account with a category.',
  },
  {
    title: 'Keep it current',
    body: 'Update a value when a statement arrives, or record trades and prices for investments you track by position. Deposits, interest, and fees go in the same way.',
  },
  {
    title: 'Watch it add up',
    body: 'Your net worth, where it sits, and how much came from saving versus returns build up from that history. Set goals and see whether they are on track.',
  },
]

/** The first-run guide shown instead of the dashboard while the portfolio is empty. */
export function FirstRun() {
  const navigate = useNavigate()
  const { displayName, baseCurrency, appName } = usePrefs()
  const { user } = useSession()
  const name = displayName.trim() || user?.username || ''
  return (
    <div className="page">
      <PageHeader title={name ? `Welcome, ${name}` : 'Welcome'} description={`${appName} is your private ledger for everything you own and owe. Here is how it works.`} />

      <section aria-labelledby="first-run-steps" className="card overflow-hidden rounded-xl">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="p-5 md:p-8">
            <h2 id="first-run-steps" className="display text-lg text-ink">
              Three steps to your first net worth
            </h2>
            <ol className="mt-5 flex flex-col">
              {STEPS.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4 border-t border-line py-4 first:border-t-0 first:pt-0">
                  <span aria-hidden className="display num grid size-9 place-items-center rounded-full border border-line-strong/60 text-md text-accent">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-md font-semibold text-ink">{s.title}</h3>
                    <p className="mt-1 max-w-[60ch] text-sm text-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-col justify-between gap-6 border-t border-line bg-sunken/50 p-5 md:p-8 lg:border-t-0 lg:border-l">
            <div>
              <p className="text-base text-ink">Start with the account you check most often. You can add the rest any time.</p>
              <Button variant="primary" size="lg" className="mt-4 w-full sm:w-auto lg:w-full" icon={<Plus size={18} aria-hidden />} onClick={() => navigate('/accounts/new')}>
                Add your first account
              </Button>
            </div>
            <div className="flex gap-3 text-sm text-muted">
              <FileSpreadsheet size={18} aria-hidden className="mt-0.5 shrink-0 text-subtle" strokeWidth={1.75} />
              <p>
                <span className="font-medium text-ink">Have past balances in a spreadsheet?</span> After adding an account, use Import history on its page to
                bring in earlier values so your charts start further back.
              </p>
            </div>
            <p className="border-t border-line pt-4 text-sm text-muted">
              Totals are shown in <span className="font-medium text-ink">{baseCurrency}</span>. Accounts in other currencies are converted with the rates you
              add.{' '}
              <Link to="/settings/currencies" className="link inline-flex items-center gap-0.5">
                Currency settings <ArrowRight size={13} aria-hidden />
              </Link>
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
