import { Popover as P } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const PopoverRoot = P.Root
export const PopoverTrigger = P.Trigger
export const PopoverClose = P.Close

export function PopoverContent({ children, className, align = 'end', label }: { children: ReactNode; className?: string; align?: 'start' | 'end' | 'center'; label: string }) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={8}
        collisionPadding={8}
        aria-label={label}
        className={cn('wb-pop z-50 w-[min(400px,calc(100vw-16px))] rounded-lg border border-line bg-raised shadow-e3 outline-none', className)}
      >
        {children}
      </P.Content>
    </P.Portal>
  )
}
