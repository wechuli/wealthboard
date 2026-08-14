import Decimal from "decimal.js";
import { z } from "zod";

import {
  beneficiaryKinds,
  contributionFrequencies,
  estateAllocationTiers,
  estateDistributionMethods,
  estateTransferContexts,
  goalStatuses,
  institutionTypes,
  investmentAssetTypes,
  investmentIdentifierTypes,
  positionEventTypes,
  transactionTypes,
} from "@/db/schema";
import {
  DEFAULT_BASE_CURRENCY,
  isCatalogCurrencyCode,
  isIsoCurrencyCode,
} from "@/lib/currencies";
import { canonicalizeInstitutionName, isHttpUrl } from "@/lib/institutions";

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isIsoCurrencyCode, "Choose a valid currency.");

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => value || undefined);

const optionalUuid = z
  .union([z.literal(""), z.string().uuid()])
  .optional()
  .transform((value) => value || undefined);

const optionalCurrencyCodeSchema = z
  .union([z.literal(""), currencyCodeSchema])
  .optional()
  .transform((value) => value || undefined);

const optionalDateSchema = z
  .union([z.literal(""), z.string().date()])
  .optional()
  .transform((value) => value || undefined);

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "Enter a valid username."),
  password: z.string().min(1, "Enter your password.").max(256),
});

export const signupSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9._-]{3,32}$/,
        "Use 3-32 letters, numbers, dots, underscores, or hyphens.",
      ),
    displayName: z.string().trim().min(1, "Enter your display name.").max(80),
    baseCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCatalogCurrencyCode, "Choose a currency from the catalog.")
      .default(DEFAULT_BASE_CURRENCY),
    password: z.string().min(12, "Use at least 12 characters.").max(256),
    confirmPassword: z.string().max(256),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(256),
    newPassword: z.string().min(12, "Use at least 12 characters.").max(256),
    confirmPassword: z.string().max(256),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const passwordConfirmationSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(256),
});

export const localCredentialSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9._-]{3,32}$/,
        "Use 3-32 letters, numbers, dots, underscores, or hyphens.",
      ),
    password: z.string().min(12, "Use at least 12 characters.").max(256),
    confirmPassword: z.string().max(256),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const accountSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Enter an account name.").max(100),
  description: optionalText,
  categoryId: z.string().min(1, "Choose a category."),
  institutionId: optionalUuid,
  accountReference: z.string().trim().max(50).optional(),
  currency: currencyCodeSchema,
  trackingMode: z.enum(["balance", "positions"]).optional(),
  openingValue: z.string().trim().min(1),
  costBasis: z.string().trim().optional(),
  isIncludedInNetWorth: z.boolean(),
  notes: optionalText,
  openedAt: z.string().date().optional(),
});

const decimalInput = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}.`)
    .max(100)
    .regex(/^-?\d+(?:\.\d+)?$/, `Enter a valid ${label}.`);

export const investmentInstrumentSchema = z.object({
  externalId: z.string().trim().max(200).optional(),
  name: z.string().trim().min(1, "Enter an instrument name.").max(100),
  symbol: z.string().trim().max(30).optional(),
  identifierType: z.enum(investmentIdentifierTypes),
  identifier: z.string().trim().max(100).optional(),
  exchangeMic: z.string().trim().max(20).optional(),
  assetType: z.enum(investmentAssetTypes),
  quoteCurrency: currencyCodeSchema,
});

export const positionEventSchema = z.object({
  accountId: z.string().uuid(),
  instrumentId: z.string().uuid(),
  type: z.enum(positionEventTypes),
  quantity: decimalInput("a quantity"),
  unitPrice: z.string().trim().max(100).optional(),
  tradeCurrency: currencyCodeSchema,
  feeAmount: z.string().trim().max(100).optional(),
  feeCurrency: optionalCurrencyCodeSchema,
  cashEffect: z.string().trim().max(100).optional(),
  appliedExchangeRate: z.string().trim().max(100).optional(),
  openingCostBasis: z.string().trim().max(100).optional(),
  tradeDate: z.string().date(),
  settlementDate: optionalDateSchema,
  externalId: z.string().trim().max(200).optional(),
  eventGroupId: z.string().uuid().optional(),
  idempotencyKey: z.string().uuid(),
  description: z.string().trim().max(200).optional(),
  notes: optionalText,
});

export const securityPriceSchema = z.object({
  accountId: z.string().uuid(),
  instrumentId: z.string().uuid(),
  externalId: z.string().trim().max(200).optional(),
  price: decimalInput("a unit price"),
  effectiveDate: z.string().date(),
  source: z.string().trim().min(1).max(100).default("manual"),
  provenance: z.string().trim().max(500).optional(),
});

export const positionReconciliationSchema = z.object({
  accountId: z.string().uuid(),
  observationDate: z.string().date(),
  reportedCash: z.string().trim().max(100).optional(),
  reportedTotal: decimalInput("a reported total"),
  notes: optionalText,
});

export const accountConversionHoldingSchema = z.object({
  instrumentId: z.string().uuid(),
  quantity: decimalInput("a quantity"),
  price: decimalInput("a unit price"),
  openingCostBasis: z.string().trim().max(100).optional(),
  priceSource: z.string().trim().min(1).max(100).default("conversion"),
  priceProvenance: z.string().trim().max(500).optional(),
});

export function parseAccountConversionHoldings(value: string) {
  return z
    .array(accountConversionHoldingSchema)
    .min(1)
    .max(1000)
    .parse(JSON.parse(value) as unknown);
}

export const accountConversionSchema = z.object({
  sourceAccountId: z.string().uuid(),
  targetName: z.string().trim().min(1).max(100),
  conversionDate: z.string().date(),
  openingCash: decimalInput("opening cash"),
  holdingsJson: z.string().superRefine((value, context) => {
    try {
      const parsed = z
        .array(accountConversionHoldingSchema)
        .min(1)
        .max(1000)
        .safeParse(JSON.parse(value) as unknown);
      if (!parsed.success) {
        context.addIssue({
          code: "custom",
          message:
            parsed.error.issues[0]?.message ?? "Opening holdings are invalid.",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Opening holdings are invalid.",
      });
    }
  }),
  idempotencyKey: z.string().uuid(),
  confirmDifference: z.boolean().default(false),
});

export const investmentCommandSchema = z
  .object({
    command: z.enum([
      "reinvestment",
      "in_kind_transfer",
      "split",
      "spinoff",
      "merger",
    ]),
    accountId: z.string().uuid(),
    instrumentId: z.string().uuid().optional(),
    destinationAccountId: z.string().uuid().optional(),
    destinationInstrumentId: z.string().uuid().optional(),
    dividendAmount: z.string().trim().max(100).optional(),
    quantity: z.string().trim().max(100).optional(),
    unitPrice: z.string().trim().max(100).optional(),
    tradeCurrency: optionalCurrencyCodeSchema,
    feeAmount: z.string().trim().max(100).optional(),
    feeCurrency: optionalCurrencyCodeSchema,
    cashEffect: z.string().trim().max(100).optional(),
    appliedExchangeRate: z.string().trim().max(100).optional(),
    numerator: z.string().trim().max(100).optional(),
    denominator: z.string().trim().max(100).optional(),
    activityDate: z.string().date(),
    idempotencyKey: z.string().uuid(),
    notes: optionalText,
  })
  .superRefine((value, context) => {
    const requireField = (
      field:
        | "instrumentId"
        | "destinationAccountId"
        | "destinationInstrumentId"
        | "dividendAmount"
        | "quantity"
        | "unitPrice"
        | "numerator"
        | "denominator",
      message: string,
    ) => {
      if (!value[field]) {
        context.addIssue({ code: "custom", path: [field], message });
      }
    };
    if (value.command === "reinvestment") {
      requireField("instrumentId", "Choose an instrument.");
      requireField("dividendAmount", "Enter the dividend amount.");
      requireField("quantity", "Enter the purchased quantity.");
      requireField("unitPrice", "Enter the execution price.");
    }
    if (value.command === "in_kind_transfer") {
      requireField("instrumentId", "Choose an instrument.");
      requireField("destinationAccountId", "Choose a destination account.");
      requireField("quantity", "Enter the transferred quantity.");
    }
    if (value.command === "split") {
      requireField("instrumentId", "Choose an instrument.");
      requireField("numerator", "Enter the new-share ratio.");
      requireField("denominator", "Enter the old-share ratio.");
    }
    if (value.command === "spinoff" || value.command === "merger") {
      requireField("instrumentId", "Choose the source instrument.");
      requireField(
        "destinationInstrumentId",
        "Choose the resulting instrument.",
      );
      requireField("numerator", "Enter the resulting-share ratio.");
      requireField("denominator", "Enter the source-share ratio.");
    }
  });

export type AccountConversionFormInput = z.input<
  typeof accountConversionSchema
>;
export type InvestmentCommandInput = z.input<typeof investmentCommandSchema>;

const optionalInstitutionText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => value || undefined);

export const institutionSchema = z.object({
  name: z
    .string()
    .max(200)
    .transform(canonicalizeInstitutionName)
    .pipe(z.string().min(1, "Enter an institution name.").max(100)),
  type: z.enum(institutionTypes),
  websiteUrl: optionalInstitutionText(500).refine(
    (value) => !value || isHttpUrl(value),
    "Enter a valid HTTP or HTTPS website.",
  ),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((value) => value || undefined)
    .refine(
      (value) => value === undefined || /^[A-Z]{2}$/.test(value),
      "Use a two-letter country code.",
    ),
  address: optionalInstitutionText(500),
  notes: optionalInstitutionText(2000),
});

const ordinaryTransactionTypeSchema = z
  .enum(transactionTypes)
  .exclude(["opening_balance", "transfer"]);

const transactionMutationFields = {
  type: ordinaryTransactionTypeSchema,
  amount: z.string().trim().min(1),
  transactionDate: z.string().date(),
  description: z.string().trim().max(200).optional(),
  externalId: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => value || undefined),
  notes: optionalText,
};

export const transactionSchema = z.object({
  accountId: z.string().uuid(),
  ...transactionMutationFields,
  idempotencyKey: z.string().uuid(),
});

export const transactionUpdateSchema = z.object({
  accountId: z.string().uuid(),
  ...transactionMutationFields,
});

const optionalTransactionQueryText = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => value || undefined)
  .catch(undefined);

export const transactionListQuerySchema = z.object({
  q: optionalTransactionQueryText,
  accountId: z.string().uuid().optional().catch(undefined),
  type: z.enum(transactionTypes).optional().catch(undefined),
  from: z.string().date().optional().catch(undefined),
  to: z.string().date().optional().catch(undefined),
  flow: z.enum(["inflow", "outflow"]).optional().catch(undefined),
  sort: z.enum(["newest", "oldest"]).default("newest").catch("newest"),
  cursor: z.string().max(1000).optional().catch(undefined),
  page: z.enum(["next", "previous"]).default("next").catch("next"),
});

export const transactionCursorSchema = z.object({
  transactionDate: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().min(1).max(100),
});

export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;

export function parseTransactionListQuery(
  input: Record<string, string | string[] | undefined>,
) {
  return transactionListQuerySchema.parse(
    Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        Array.isArray(value) ? value[0] : value,
      ]),
    ),
  );
}

export const valuationSchema = z.object({
  idempotencyKey: z.string().uuid(),
  accountId: z.string().uuid(),
  value: z.string().trim().min(1),
  valuationDate: z.string().date(),
  notes: optionalText,
});

export const transferSchema = z
  .object({
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    amount: z.string().trim().min(1),
    destinationAmount: z.string().trim().optional(),
    transactionDate: z.string().date(),
    description: z.string().trim().max(200).optional(),
    idempotencyKey: z.string().uuid(),
  })
  .refine((data) => data.fromAccountId !== data.toAccountId, {
    message: "Choose two different accounts.",
    path: ["toAccountId"],
  });

export const goalSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Enter a goal name.").max(100),
  description: optionalText,
  targetAmount: z.string().trim().min(1),
  currentAmount: z.string().trim().optional(),
  currency: currencyCodeSchema,
  targetDate: z.string().date(),
  linkedAccountId: z.string().uuid().optional().or(z.literal("")),
  icon: z.string().trim().max(50).default("Target"),
  status: z.enum(goalStatuses).default("active"),
  priority: z.coerce.number().int().min(0).max(100).default(0),
  assumedAnnualReturn: z.coerce.number().min(0).max(100),
  plannedContribution: z.string().trim().min(1),
  frequency: z.enum(contributionFrequencies).default("monthly"),
  planStartDate: z.string().date(),
  planEndDate: z.string().date().optional().or(z.literal("")),
});

export const goalMilestoneSchema = z.object({
  name: z.string().trim().min(1, "Enter a milestone name.").max(100),
  targetAmount: z.string().trim().min(1, "Enter a milestone amount."),
  targetDate: z.string().date().optional().or(z.literal("")),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  icon: z.string().trim().min(1).max(50),
  assetOrLiability: z.enum(["asset", "liability"]),
  description: optionalText,
  isLiquid: z.boolean().default(false),
  isInvestible: z.boolean().default(true),
});

const estatePercentageBps = z
  .string()
  .trim()
  .regex(
    /^\d{1,3}(?:\.\d{1,2})?$/,
    "Use a percentage with at most two decimal places.",
  )
  .refine(
    (value) =>
      new Decimal(value).greaterThan(0) &&
      new Decimal(value).lessThanOrEqualTo(100),
    "Enter a percentage greater than 0 and no more than 100.",
  )
  .transform((value) => new Decimal(value).mul(100).toNumber());

export const beneficiarySchema = z.object({
  kind: z.enum(beneficiaryKinds),
  name: z.string().trim().min(1, "Enter a beneficiary name.").max(120),
  relationship: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((value) => value || undefined),
  contactSummary: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || undefined),
  notes: optionalText,
});

export const estatePlanSchema = z.object({
  title: z.string().trim().min(1, "Enter a plan title.").max(120),
  jurisdiction: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value || undefined),
  lastReviewedDate: z.string().date().optional().or(z.literal("")),
  reviewReminderDate: z.string().date().optional().or(z.literal("")),
});

export const estateDirectiveSchema = z.object({
  isIncluded: z.boolean(),
  ownershipShareBps: estatePercentageBps,
  transferContext: z.enum(estateTransferContexts),
  distributionMethod: z.enum(estateDistributionMethods),
  documentReference: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || undefined),
  notes: optionalText,
  reviewedAt: z.string().date().optional().or(z.literal("")),
});

export const estateAllocationSchema = z.object({
  beneficiaryId: z.string().uuid(),
  tier: z.enum(estateAllocationTiers),
  allocationBps: estatePercentageBps,
  notes: optionalText,
});

export type BeneficiaryInput = z.infer<typeof beneficiarySchema>;
export type EstatePlanInput = z.infer<typeof estatePlanSchema>;
export type EstateDirectiveInput = z.infer<typeof estateDirectiveSchema>;
export type EstateAllocationInput = z.infer<typeof estateAllocationSchema>;

export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export function formDataObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export function zodActionError(error: z.ZodError): ActionState {
  return {
    message: "Check the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors,
  };
}
