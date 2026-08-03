import { z } from "zod";

import {
  contributionFrequencies,
  goalStatuses,
  transactionTypes,
} from "@/db/schema";
import {
  DEFAULT_BASE_CURRENCY,
  isCatalogCurrencyCode,
  isIsoCurrencyCode,
} from "@/lib/currencies";

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

export const accountSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Enter an account name.").max(100),
  description: optionalText,
  categoryId: z.string().min(1, "Choose a category."),
  institution: z.string().trim().max(100).optional(),
  accountReference: z.string().trim().max(50).optional(),
  currency: currencyCodeSchema,
  openingValue: z.string().trim().min(1),
  costBasis: z.string().trim().optional(),
  isIncludedInNetWorth: z.boolean(),
  notes: optionalText,
  openedAt: z.string().date().optional(),
});

export const transactionSchema = z.object({
  accountId: z.string().uuid(),
  type: z.enum(transactionTypes),
  amount: z.string().trim().min(1),
  transactionDate: z.string().date(),
  description: z.string().trim().max(200).optional(),
  notes: optionalText,
  idempotencyKey: z.string().uuid(),
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
