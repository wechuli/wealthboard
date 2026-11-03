import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Button } from './Button'

interface BaseProps {
  open: boolean
  onOpenChange(open: boolean): void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
}

/** Centered dialog for confirmations and short focused tasks. Focus is trapped and restored. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: BaseProps & { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="wb-overlay fixed inset-0 z-50 bg-scrim" />
        <D.Content
          className={cn(
            'wb-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-surface shadow-e3',
            size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div>
              <D.Title className="text-lg font-semibold text-ink">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
            </div>
            <D.Close className="-mr-2 -mt-1 grid size-11 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink md:size-9" aria-label="Close">
              <X size={18} aria-hidden />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/** Destructive-action confirmation. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
  tone = 'danger',
  children,
  confirmDisabled,
}: BaseProps & { confirmLabel: string; onConfirm(): void; pending?: boolean; tone?: 'danger' | 'primary'; confirmDisabled?: boolean }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={pending} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}

/** Sheet: full-screen on mobile, a right-hand panel on tablet and desktop. Use for forms. */
export function Sheet({ open, onOpenChange, title, description, children, footer, width = 'md' }: BaseProps & { width?: 'md' | 'lg' }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="wb-overlay fixed inset-0 z-50 bg-scrim" />
        <D.Content
          className={cn(
            'wb-sheet fixed inset-0 z-50 flex flex-col bg-surface shadow-e3 md:inset-y-2 md:left-auto md:right-2 md:rounded-xl md:border md:border-line',
            width === 'lg' ? 'md:w-[min(720px,calc(100vw-16px))]' : 'md:w-[min(480px,calc(100vw-16px))]',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="min-w-0">
              <D.Title className="text-lg font-semibold text-ink">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">Form</D.Description>}
            </div>
            <D.Close className="-mr-2 grid size-11 shrink-0 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink md:size-9" aria-label="Close">
              <X size={18} aria-hidden />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
