import { ToggleGroup } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Single-choice segmented control (for example, chart ranges). Arrow keys move between options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
}: {
  value: T
  onChange(value: T): void
  options: { value: T; label: ReactNode; ariaLabel?: string }[]
  label: string
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className={cn('inline-flex shrink-0 rounded-md border border-line bg-sunken p-0.5', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
          className={cn(
            'num rounded-[7px] font-medium text-muted transition-[background-color,color,box-shadow] duration-[var(--dur-1)] hover:text-ink data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-e1',
            size === 'sm' ? 'h-8 min-w-9 px-2 text-xs' : 'h-10 min-w-11 px-3 text-sm md:h-9',
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
