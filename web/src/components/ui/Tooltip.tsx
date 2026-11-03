import { Tooltip as T } from 'radix-ui'
import type { ReactNode } from 'react'
import { Kbd } from './Kbd'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={350} skipDelayDuration={150}>
      {children}
    </T.Provider>
  )
}

export function Tooltip({ content, shortcut, children, side = 'bottom' }: { content: ReactNode; shortcut?: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="wb-pop z-50 flex items-center gap-2 rounded-sm bg-ink px-2 py-1 text-xs font-medium text-canvas shadow-e2 dark:bg-raised dark:text-ink dark:border dark:border-line"
        >
          {content}
          {shortcut ? <Kbd tone="inverse">{shortcut}</Kbd> : null}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
