import { Slot } from 'radix-ui'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium select-none transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--dur-1)] ease-out active:translate-y-px disabled:opacity-55 disabled:active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent shadow-e1 hover:bg-accent-strong disabled:hover:bg-accent',
  secondary: 'bg-surface text-ink border border-line-strong/70 hover:bg-sunken hover:border-line-strong',
  ghost: 'text-muted hover:text-ink hover:bg-sunken',
  subtle: 'bg-accent-soft text-accent hover:bg-accent-soft/70',
  danger: 'bg-negative text-white hover:brightness-95 dark:text-canvas',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm min-w-9',
  md: 'h-11 px-4 text-base min-w-11 md:h-10',
  lg: 'h-12 px-5 text-md min-w-12',
}

export function buttonClass({ variant = 'secondary', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(base, variants[variant], sizes[size], className)
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, asChild, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      className={buttonClass({ variant, size, className })}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner size={16} /> : icon}
          {children}
        </>
      )}
    </Comp>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; also shown as a tooltip. */
  label: string
  icon: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  tooltip?: boolean
  shortcut?: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', tooltip = true, shortcut, className, type = 'button', ...rest },
  ref,
) {
  const button = (
    <button ref={ref} type={type} aria-label={label} className={buttonClass({ variant, size, className: cn('px-0', size === 'sm' ? 'w-9' : 'w-11 md:w-10', className) })} {...rest}>
      {icon}
    </button>
  )
  if (!tooltip) return button
  return (
    <Tooltip content={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  )
})
