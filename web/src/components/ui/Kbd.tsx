import { cn } from '@/lib/cn'

export function Kbd({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'inverse' }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 font-sans text-[11px] font-medium leading-none',
        tone === 'inverse' ? 'bg-white/15 text-inherit dark:bg-black/20' : 'border border-line bg-sunken text-muted',
      )}
    >
      {children}
    </kbd>
  )
}
