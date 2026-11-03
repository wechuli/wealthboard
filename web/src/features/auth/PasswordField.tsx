import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { FieldShell, inputClass } from '@/components/ui/Field'
import { cn } from '@/lib/cn'

type Props = { label: ReactNode; hint?: ReactNode; error?: string; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/** Password input with a show/hide toggle that keeps focus in place. */
export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField({ label, hint, error, className, ...rest }, ref) {
  const [visible, setVisible] = useState(false)
  return (
    <FieldShell label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <input
            ref={ref}
            id={id}
            type={visible ? 'text' : 'password'}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={cn(inputClass, 'pr-12')}
            {...rest}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-controls={id}
            className="absolute right-0.5 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-md text-muted transition-colors duration-[var(--dur-1)] hover:text-ink md:size-9"
          >
            {visible ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
          </button>
        </div>
      )}
    </FieldShell>
  )
})

export const MIN_PASSWORD = 12

/** A gentle, local-only strength hint. The server decides what it accepts. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (pw.length === 0) return { score: 0, label: `At least ${MIN_PASSWORD} characters. A short phrase of four or more words works well.` }
  if (pw.length < MIN_PASSWORD) {
    const left = MIN_PASSWORD - pw.length
    return { score: 1, label: `Too short: ${left} more character${left === 1 ? '' : 's'}` }
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  const words = pw.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3).length
  const repeated = /(.)\1{3,}/.test(pw)
  let points = 0
  if (pw.length >= 16) points++
  if (pw.length >= 20 || words >= 4) points++
  if (classes >= 3) points++
  if (repeated) points--
  if (points >= 2) return { score: 4, label: 'Strong' }
  if (points === 1) return { score: 3, label: 'Good' }
  return { score: 2, label: 'Fair. Longer is stronger; add a word or two.' }
}

export function PasswordStrength({ value, id }: { value: string; id?: string }) {
  const { score, label } = passwordStrength(value)
  const tone = score <= 1 ? 'bg-negative' : score === 2 ? 'bg-warning' : 'bg-positive'
  return (
    <div id={id} className="mt-2">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={cn('h-1 flex-1 rounded-full transition-colors duration-[var(--dur-2)]', score >= n && value ? tone : 'bg-sunken')} />
        ))}
      </div>
      <p className={cn('mt-1.5 text-xs', score <= 1 && value ? 'text-negative' : 'text-muted')}>
        {value && score >= 2 ? <span className="font-medium text-ink">Strength: </span> : null}
        {label}
      </p>
    </div>
  )
}
