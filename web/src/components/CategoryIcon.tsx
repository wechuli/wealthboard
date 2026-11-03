import {
  BadgeDollarSign,
  Baby,
  Briefcase,
  BriefcaseBusiness,
  Car,
  CarFront,
  ChartCandlestick,
  CircleDollarSign,
  CreditCard,
  Gem,
  Globe,
  GraduationCap,
  HandCoins,
  Heart,
  Home,
  Hourglass,
  House,
  Landmark,
  Laptop,
  Map,
  PiggyBank,
  Plane,
  ScrollText,
  Shield,
  Target,
  TrendingUp,
  Umbrella,
  Wallet,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The fixed icon set for categories and goals. Names are PascalCase Lucide identifiers, which is
 * what the API stores (for example "PiggyBank"); kebab-case aliases are also accepted.
 */
export const ICONS: Record<string, LucideIcon> = {
  ChartCandlestick,
  TrendingUp,
  Landmark,
  BadgeDollarSign,
  ScrollText,
  PiggyBank,
  WalletCards,
  Wallet,
  House,
  Home,
  Map,
  CarFront,
  Car,
  Umbrella,
  Hourglass,
  BriefcaseBusiness,
  Briefcase,
  Gem,
  CreditCard,
  HandCoins,
  CircleDollarSign,
  Target,
  Shield,
  GraduationCap,
  Globe,
  Plane,
  Laptop,
  Baby,
  Heart,
}

/** Icons offered in pickers, in display order. */
export const ICON_NAMES = Object.keys(ICONS)

/** Converts "piggy-bank" or "PiggyBank" to the canonical "PiggyBank". */
export function canonicalIconName(name: string): string {
  if (!name.includes('-')) return name.charAt(0).toUpperCase() + name.slice(1)
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function CategoryIcon({ name, size = 18, className, framed }: { name: string; size?: number; className?: string; framed?: boolean }) {
  const Icon = ICONS[canonicalIconName(name)] ?? CircleDollarSign
  if (!framed) return <Icon size={size} aria-hidden className={className} strokeWidth={1.75} />
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-md bg-sunken text-muted', className)}>
      <Icon size={size} aria-hidden strokeWidth={1.75} />
    </span>
  )
}
