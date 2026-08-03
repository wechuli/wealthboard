import type { TransactionType } from "@/db/schema";
import { DEFAULT_BASE_CURRENCY } from "@/lib/currencies";

export const PRODUCT_NAME = "Wealthboard";
export const DEFAULT_TIMEZONE = "Africa/Nairobi";
export const DEFAULT_CURRENCY = DEFAULT_BASE_CURRENCY;

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  opening_balance: "Opening Balance",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  interest: "Interest",
  dividend: "Dividend",
  capital_gain: "Capital Gain",
  capital_loss: "Capital Loss",
  fee: "Fee",
  purchase: "Purchase",
  sale: "Sale",
  manual_adjustment: "Manual Adjustment",
  liability_payment: "Liability Payment",
  liability_increase: "Liability Increase",
  transfer: "Transfer",
};

export const CATEGORY_SEEDS = [
  ["Securities", "securities", "ChartCandlestick", "asset", false, true],
  ["Money Market Fund", "money-market-fund", "Landmark", "asset", true, true],
  ["Fixed Income", "fixed-income", "BadgeDollarSign", "asset", false, true],
  ["Savings", "savings", "PiggyBank", "asset", true, true],
  ["Cash", "cash", "WalletCards", "asset", true, true],
  ["Land and Real Estate", "land-real-estate", "House", "asset", false, false],
  ["Vehicle", "vehicle", "CarFront", "asset", false, false],
  ["Retirement", "retirement", "Umbrella", "asset", false, true],
  ["Business", "business", "BriefcaseBusiness", "asset", false, true],
  ["Other Asset", "other-asset", "Gem", "asset", false, false],
  ["Liability", "liability", "CreditCard", "liability", false, false],
] as const;

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];
