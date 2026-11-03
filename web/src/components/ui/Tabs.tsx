import { Tabs as T } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const TabsRoot = T.Root
export const TabsContent = T.Content

/** Underlined tabs; scrolls horizontally on narrow screens. */
export function TabsList({ items, label, className }: { items: { value: string; label: ReactNode; count?: number }[]; label: string; className?: string }) {
  return (
    <T.List aria-label={label} className={cn('scroll-x -mx-4 flex gap-1 border-b border-line px-4 md:mx-0 md:px-0', className)}>
      {items.map((it) => (
        <T.Trigger
          key={it.value}
          value={it.value}
          className="relative -mb-px flex h-11 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-muted transition-colors duration-[var(--dur-1)] hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink"
        >
          {it.label}
          {it.count !== undefined ? <span className="num rounded-full bg-sunken px-1.5 text-xs text-subtle">{it.count}</span> : null}
        </T.Trigger>
      ))}
    </T.List>
  )
}
