import { DropdownMenu as M } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const MenuRoot = M.Root
export const MenuTrigger = M.Trigger
export const MenuGroup = M.Group
export const MenuRadioGroup = M.RadioGroup

export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={6} collisionPadding={8} className={cn('wb-pop z-50 min-w-56 rounded-lg border border-line bg-raised p-1.5 shadow-e3', className)}>
        {children}
      </M.Content>
    </M.Portal>
  )
}

const itemClass =
  'flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-sm text-ink outline-none data-[highlighted]:bg-sunken data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'

export function MenuItem({ children, icon, onSelect, disabled, tone, hint }: { children: ReactNode; icon?: ReactNode; onSelect?: () => void; disabled?: boolean; tone?: 'danger'; hint?: ReactNode }) {
  return (
    <M.Item onSelect={onSelect} disabled={disabled} className={cn(itemClass, tone === 'danger' && 'text-negative')}>
      <span className="text-muted [&>svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span className="flex-1">{children}</span>
      {hint ? <span className="text-xs text-subtle">{hint}</span> : null}
    </M.Item>
  )
}

export function MenuRadioItem({ value, children, icon }: { value: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <M.RadioItem value={value} className={itemClass}>
      <span className="text-muted [&>svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span className="flex-1">{children}</span>
      <M.ItemIndicator className="size-2 rounded-full bg-accent" />
    </M.RadioItem>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2.5 pb-1 pt-2 text-xs font-medium text-subtle">{children}</M.Label>
}

export function MenuSeparator() {
  return <M.Separator className="my-1.5 h-px bg-line" />
}
