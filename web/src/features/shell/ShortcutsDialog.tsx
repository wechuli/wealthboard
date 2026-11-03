import { Dialog } from '@/components/ui/Dialog'
import { Kbd } from '@/components/ui/Kbd'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const GROUPS: { title: string; items: [keys: string[], label: string][] }[] = [
  {
    title: 'Anywhere',
    items: [
      [[isMac ? '⌘' : 'Ctrl', 'K'], 'Search and commands'],
      [['/'], 'Search and commands'],
      [['N'], 'Record something (quick add)'],
      [['Shift', 'H'], 'Hide or show values'],
      [['?'], 'This list'],
    ],
  },
  {
    title: 'Go to',
    items: [
      [['G', 'H'], 'Home'],
      [['G', 'C'], 'Accounts'],
      [['G', 'T'], 'Activity'],
      [['G', 'G'], 'Goals'],
      [['G', 'I'], 'Insights'],
      [['G', 'S'], 'Settings'],
    ],
  },
  {
    title: 'Charts',
    items: [
      [['←', '→'], 'Step through data points'],
      [['Esc'], 'Clear the crosshair'],
    ],
  },
]

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" description="Single-key shortcuts work whenever you are not typing in a field.">
      <div className="grid gap-6 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-xs font-medium text-subtle">{g.title}</h3>
            <dl className="flex flex-col gap-2">
              {g.items.map(([keys, label]) => (
                <div key={label + keys.join()} className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-ink">{label}</dt>
                  <dd className="flex gap-1">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
