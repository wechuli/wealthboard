import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** A titled group of specimens (h2). */
export function SpecimenGroup({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h2 id={id} className="display text-lg text-ink">
        {title}
      </h2>
      {description ? <p className="mt-1 max-w-[68ch] text-sm text-muted">{description}</p> : null}
      <div className="mt-5 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  )
}

/** One specimen: a caption and a sample on a surface. */
export function Specimen({ label, children, wide, className }: { label: string; children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className={cn('card min-w-0 p-4', wide && 'md:col-span-2', className)}>
      <h3 className="mb-3 text-xs font-medium text-muted">{label}</h3>
      {children}
    </div>
  )
}

/**
 * A colour swatch. The resolved value is read from the computed style of the swatch itself, so a
 * swatch inside a scoped theme panel shows that panel's value. Written straight to the DOM (no state).
 */
export function Swatch({ token, refreshKey }: { token: string; refreshKey?: string }) {
  const swatchRef = useRef<HTMLSpanElement>(null)
  const valueRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (!swatchRef.current || !valueRef.current) return
    valueRef.current.textContent = getComputedStyle(swatchRef.current).getPropertyValue(token).trim() || '—'
  }, [token, refreshKey])
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span ref={swatchRef} aria-hidden className="size-9 shrink-0 rounded-md border border-line shadow-e1" style={{ background: `var(${token})` }} />
      <span className="min-w-0">
        <span className="block truncate font-mono text-xs text-ink">{token}</span>
        <span ref={valueRef} className="num block truncate font-mono text-[11px] text-subtle" />
      </span>
    </div>
  )
}
