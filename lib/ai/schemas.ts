import { z } from "zod";

export const portfolioReviewPeriods = ["1m", "3m", "6m", "1y", "all"] as const;
export const portfolioReviewFocuses = [
  "overall",
  "allocation",
  "goals",
  "cash-flow",
  "data-quality",
] as const;

export const portfolioReviewOptionsSchema = z
  .object({
    period: z.enum(portfolioReviewPeriods).default("1y"),
    focus: z.enum(portfolioReviewFocuses).default("overall"),
    includeExactAmounts: z.boolean().default(false),
    includeAccountNames: z.boolean().default(false),
  })
  .strict();

const optionalTrimmedString = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => value || undefined);

export const aiProviderSettingsInputSchema = z
  .object({
    provider: z.enum(["openai", "deepseek", "custom"]),
    baseUrl: optionalTrimmedString(500),
    model: z.string().trim().min(1, "Enter a model identifier.").max(200),
    apiKey: optionalTrimmedString(4096).refine(
      (value) => value === undefined || value.length >= 8,
      "Enter a valid provider API key.",
    ),
    rememberApiKey: z.boolean(),
    includeExactAmounts: z.boolean(),
    includeAccountNames: z.boolean(),
    monthlyTokenLimit: z.coerce.number().int().min(10_000).max(5_000_000),
    maxOutputTokens: z.coerce.number().int().min(256).max(4_000),
  })
  .strict();

export const portfolioReviewRequestSchema = portfolioReviewOptionsSchema.extend(
  {
    apiKey: optionalTrimmedString(4096).refine(
      (value) => value === undefined || value.length >= 8,
      "Enter a valid provider API key.",
    ),
  },
);

const decimalStringSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const reviewMoneySchema = z
  .object({
    currency: currencySchema,
    amount: decimalStringSchema,
  })
  .strict();

const allocationItemSchema = z
  .object({
    evidenceId: z.string().min(1).max(120),
    label: z.string().min(1).max(100),
    sharePercent: z.string().regex(/^\d+(?:\.\d)?$/),
    amount: reviewMoneySchema.optional(),
  })
  .strict();

const reviewAccountSchema = z
  .object({
    evidenceId: z.string().min(1).max(120),
    alias: z.string().min(1).max(40),
    name: z.string().min(1).max(100).optional(),
    category: z.string().min(1).max(100),
    currency: currencySchema,
    sharePercent: z.string().regex(/^\d+(?:\.\d)?$/),
    amount: reviewMoneySchema.optional(),
  })
  .strict();

const reviewGoalSchema = z
  .object({
    evidenceId: z.string().min(1).max(120),
    alias: z.string().min(1).max(40),
    name: z.string().min(1).max(120).optional(),
    status: z.enum(["active", "paused", "completed", "cancelled"]),
    tracking: z.enum(["ahead", "on_track", "behind"]),
    progressPercent: z.string().regex(/^\d+(?:\.\d)?$/),
    plannedToRequiredPercent: z
      .string()
      .regex(/^\d+(?:\.\d)?$/)
      .nullable(),
    targetDate: z.string().datetime({ offset: true }),
    missingExchangeRate: z.boolean(),
    currentAmount: reviewMoneySchema.optional(),
    targetAmount: reviewMoneySchema.optional(),
    requiredMonthly: reviewMoneySchema.optional(),
  })
  .strict();

const dataQualityItemSchema = z
  .object({
    evidenceId: z.string().min(1).max(120),
    code: z.string().min(1).max(80),
    severity: z.enum(["info", "warning", "critical"]),
    message: z.string().min(1).max(400),
  })
  .strict();

export const portfolioReviewSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    asOf: z.string().datetime({ offset: true }),
    period: z.enum(portfolioReviewPeriods),
    focus: z.enum(portfolioReviewFocuses),
    baseCurrency: currencySchema,
    sharing: z
      .object({
        exactAmounts: z.boolean(),
        accountNames: z.boolean(),
      })
      .strict(),
    completeness: z
      .object({
        complete: z.boolean(),
        missingCurrencies: z.array(currencySchema).max(50),
        omittedMetrics: z.array(z.string().min(1).max(120)).max(20),
      })
      .strict(),
    portfolio: z
      .object({
        accountCount: z.number().int().min(0),
        goalCount: z.number().int().min(0),
        totals: z
          .object({
            evidenceId: z.literal("portfolio.totals"),
            assets: reviewMoneySchema.optional(),
            liabilities: reviewMoneySchema.optional(),
            netWorth: reviewMoneySchema.optional(),
          })
          .strict(),
        ratios: z
          .object({
            evidenceId: z.literal("portfolio.ratios"),
            liabilitiesToAssetsPercent: z.string().regex(/^\d+(?:\.\d)?$/),
            liquidAssetsPercent: z.string().regex(/^\d+(?:\.\d)?$/),
            investibleAssetsPercent: z.string().regex(/^\d+(?:\.\d)?$/),
          })
          .strict(),
        periodChange: z
          .object({
            evidenceId: z.literal("portfolio.period-change"),
            percent: z
              .string()
              .regex(/^-?\d+(?:\.\d)?$/)
              .nullable(),
            amount: reviewMoneySchema.optional(),
          })
          .strict(),
      })
      .strict(),
    allocations: z
      .object({
        categories: z.array(allocationItemSchema).max(12),
        currencies: z.array(allocationItemSchema).max(12),
      })
      .strict(),
    topAccounts: z.array(reviewAccountSchema).max(10),
    cashFlow: z
      .object({
        evidenceId: z.literal("cash-flow.summary"),
        contributionsAsPercentOfAssets: z.string().regex(/^\d+(?:\.\d)?$/),
        withdrawalsAsPercentOfAssets: z.string().regex(/^\d+(?:\.\d)?$/),
        incomeAsPercentOfAssets: z.string().regex(/^\d+(?:\.\d)?$/),
        feesAsPercentOfAssets: z.string().regex(/^\d+(?:\.\d)?$/),
        contributions: reviewMoneySchema.optional(),
        withdrawals: reviewMoneySchema.optional(),
        income: reviewMoneySchema.optional(),
        fees: reviewMoneySchema.optional(),
      })
      .strict(),
    goals: z.array(reviewGoalSchema).max(10),
    dataQuality: z.array(dataQualityItemSchema).max(20),
    methodology: z.array(z.string().min(1).max(400)).min(1).max(20),
  })
  .strict();

const reviewFindingSchema = z
  .object({
    id: z.string().min(1).max(80),
    category: z.enum([
      "data-quality",
      "allocation",
      "liquidity",
      "cash-flow",
      "goals",
      "general",
    ]),
    severity: z.enum(["info", "attention", "high"]),
    confidence: z.enum(["low", "medium", "high"]),
    title: z.string().min(1).max(140),
    explanation: z.string().min(1).max(700),
    evidenceRefs: z.array(z.string().min(1).max(120)).min(1).max(6),
  })
  .strict();

export const portfolioAiReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    headline: z.string().min(1).max(160),
    executiveSummary: z.string().min(1).max(1400),
    dataQuality: z.array(reviewFindingSchema).max(6),
    strengths: z.array(reviewFindingSchema).max(6),
    attentionItems: z.array(reviewFindingSchema).max(8),
    goalObservations: z.array(reviewFindingSchema).max(6),
    questions: z.array(z.string().min(1).max(300)).max(6),
    possibleNextChecks: z.array(z.string().min(1).max(300)).max(6),
    limitations: z.array(z.string().min(1).max(300)).min(1).max(8),
  })
  .strict();

export type PortfolioReviewOptions = z.infer<
  typeof portfolioReviewOptionsSchema
>;
export type AiProviderSettingsInput = z.infer<
  typeof aiProviderSettingsInputSchema
>;
export type PortfolioReviewSnapshot = z.infer<
  typeof portfolioReviewSnapshotSchema
>;
export type PortfolioAiReview = z.infer<typeof portfolioAiReviewSchema>;
