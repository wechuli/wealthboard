import {
  BadgeDollarSign,
  BarChart3,
  BriefcaseBusiness,
  CarFront,
  ChartCandlestick,
  CircleDollarSign,
  CreditCard,
  Gem,
  House,
  Landmark,
  PiggyBank,
  Target,
  Umbrella,
  WalletCards,
  type LucideProps,
} from "lucide-react";

const icons = {
  BadgeDollarSign,
  BarChart3,
  BriefcaseBusiness,
  CarFront,
  ChartCandlestick,
  CircleDollarSign,
  CreditCard,
  Gem,
  House,
  Landmark,
  PiggyBank,
  Target,
  Umbrella,
  WalletCards,
};

export type CategoryIconName = keyof typeof icons;

export function CategoryIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = icons[name as CategoryIconName] ?? CircleDollarSign;
  return <Icon {...props} />;
}

export const CATEGORY_ICON_OPTIONS = Object.keys(icons);
