"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import {
  accountSchema,
  categorySchema,
  formDataObject,
  goalMilestoneSchema,
  goalSchema,
  passwordChangeSchema,
  transactionSchema,
  transferSchema,
  valuationSchema,
  type ActionState,
  zodActionError,
} from "@/lib/validation";
import {
  createAccount,
  deleteTransaction,
  deleteValuation,
  recordTransaction,
  recordValuation,
  setAccountArchived,
  updateAccount,
  updateTransaction,
} from "@/lib/services/accounts";
import {
  archiveCategory,
  createCategory,
  moveCategory,
  updateCategory,
} from "@/lib/services/categories";
import {
  createGoal,
  createGoalMilestone,
  deleteGoal,
  deleteGoalMilestone,
  dismissGoalAlert,
  setGoalStatus,
  updateGoal,
} from "@/lib/services/goals";
import { recordTransfer } from "@/lib/services/transfers";
import type { GoalStatus } from "@/db/schema";
import { addExchangeRate, updateSettings } from "@/lib/services/settings";
import { createSession } from "@/lib/auth/session";
import { changeUserPassword } from "@/lib/auth/users";
import { z } from "zod";
import { isValidTimezone } from "@/lib/dates";

function mutationError(error: unknown): ActionState {
  console.error(
    "Financial mutation failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    message: error instanceof Error ? error.message : "The change could not be saved.",
  };
}

function accountInput(formData: FormData) {
  const values = formDataObject(formData);
  return accountSchema.safeParse({
    ...values,
    isIncludedInNetWorth: formData.get("isIncludedInNetWorth") === "on",
  });
}

export async function createAccountAction(formData: FormData): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = accountInput(formData);
  if (!parsed.success) return zodActionError(parsed.error);
  let id: string;
  try {
    id = createAccount(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  redirect(`/accounts/${id}?created=1`);
}

export async function updateAccountAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = accountInput(formData);
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    updateAccount(userId, id, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${id}`);
  redirect(`/accounts/${id}?updated=1`);
}

export async function archiveAccountAction(id: string, archived: boolean) {
  const { userId } = await requireSession();
  setAccountArchived(userId, id, archived);
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${id}`);
  redirect("/accounts");
}

export async function transactionAction(formData: FormData): Promise<ActionState> {
  const { userId } = await requireSession();
  const values = formDataObject(formData);
  if (values.type === "transfer") {
    const parsed = transferSchema.safeParse({
      ...values,
      fromAccountId: values.accountId,
    });
    if (!parsed.success) return zodActionError(parsed.error);
    try {
      recordTransfer(userId, parsed.data);
    } catch (error) {
      return mutationError(error);
    }
    revalidatePath("/");
    revalidatePath("/accounts");
    revalidatePath("/transactions");
    redirect("/transactions?created=1");
  }

  const parsed = transactionSchema.safeParse(values);
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    recordTransaction(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.data.accountId}`);
  revalidatePath("/transactions");
  redirect(`/accounts/${parsed.data.accountId}?transaction=created`);
}

export async function updateTransactionAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = transactionSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    updateTransaction(userId, id, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.data.accountId}`);
  revalidatePath("/transactions");
  redirect(`/accounts/${parsed.data.accountId}?transaction=updated`);
}

export async function deleteTransactionAction(id: string) {
  const { userId } = await requireSession();
  try {
    deleteTransaction(userId, id);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
}

export async function valuationAction(formData: FormData): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = valuationSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    recordValuation(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.data.accountId}`);
  redirect(`/accounts/${parsed.data.accountId}?valuation=created`);
}

export async function deleteValuationAction(id: string) {
  const { userId } = await requireSession();
  try {
    deleteValuation(userId, id);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
}

function categoryInput(formData: FormData) {
  return categorySchema.safeParse({
    ...formDataObject(formData),
    isLiquid: formData.get("isLiquid") === "on",
    isInvestible: formData.get("isInvestible") === "on",
  });
}

export async function createCategoryAction(formData: FormData): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = categoryInput(formData);
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    createCategory(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/categories");
  revalidatePath("/accounts");
  return { ok: true, message: "Category created." };
}

export async function updateCategoryAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = categoryInput(formData);
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    updateCategory(userId, id, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/categories");
  revalidatePath("/accounts");
  return { ok: true, message: "Category updated." };
}

export async function archiveCategoryAction(id: string, archived: boolean) {
  const { userId } = await requireSession();
  try {
    archiveCategory(userId, id, archived);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/categories");
  revalidatePath("/accounts");
}

export async function moveCategoryAction(id: string, direction: "up" | "down") {
  const { userId } = await requireSession();
  moveCategory(userId, id, direction);
  revalidatePath("/categories");
}

export async function createGoalAction(formData: FormData): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = goalSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  let id: string;
  try {
    id = createGoal(userId, {
      ...parsed.data,
      linkedAccountId: parsed.data.linkedAccountId || undefined,
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath("/accounts");
  redirect(`/goals/${id}?created=1`);
}

export async function updateGoalAction(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = goalSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    updateGoal(userId, id, {
      ...parsed.data,
      linkedAccountId: parsed.data.linkedAccountId || undefined,
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
  revalidatePath("/accounts");
  redirect(`/goals/${id}?updated=1`);
}

export async function setGoalStatusAction(id: string, status: GoalStatus) {
  const { userId } = await requireSession();
  setGoalStatus(userId, id, status);
  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
}

export async function deleteGoalAction(id: string) {
  const { userId } = await requireSession();
  deleteGoal(userId, id);
  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath("/accounts");
  redirect("/goals");
}

export async function createGoalMilestoneAction(
  goalId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = goalMilestoneSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    createGoalMilestone(userId, goalId, {
      ...parsed.data,
      targetDate: parsed.data.targetDate || undefined,
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath(`/goals/${goalId}`);
  revalidatePath("/goals");
  return { ok: true, message: "Milestone added." };
}

export async function deleteGoalMilestoneAction(
  goalId: string,
  milestoneId: string,
): Promise<ActionState> {
  const { userId } = await requireSession();
  try {
    deleteGoalMilestone(userId, goalId, milestoneId);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath(`/goals/${goalId}`);
  revalidatePath("/goals");
  return { ok: true, message: "Milestone deleted." };
}

export async function dismissGoalAlertAction(
  goalId: string,
): Promise<ActionState> {
  const { userId } = await requireSession();
  try {
    dismissGoalAlert(userId, goalId);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/goals");
  return { ok: true, message: "Goal reminder dismissed for this month." };
}

const settingsSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  appName: z.string().trim().min(1).max(80),
  baseCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  supportedCurrencies: z.string().transform((value) =>
    [...new Set(value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean))],
  ),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(isValidTimezone, "Enter a valid IANA timezone."),
  preferredDateFormat: z.string().trim().min(1).max(40),
  defaultDashboardPeriod: z.enum(["1m", "3m", "6m", "1y", "all"]),
  sessionTimeoutMinutes: z.coerce.number().int().min(15).max(525600),
  defaultGoalReturn: z.coerce.number().min(0).max(100),
});

export async function updateSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = settingsSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  if (!parsed.data.supportedCurrencies.includes(parsed.data.baseCurrency)) {
    parsed.data.supportedCurrencies.unshift(parsed.data.baseCurrency);
  }
  try {
    updateSettings(userId, {
      ...parsed.data,
      defaultGoalReturnBps: Math.round(parsed.data.defaultGoalReturn * 100),
    });
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved." };
}

const exchangeRateSchema = z.object({
  baseCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  quoteCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  rate: z.string().trim().regex(/^\d+(?:\.\d+)?$/),
  effectiveDate: z.string().date(),
});

export async function exchangeRateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = exchangeRateSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  try {
    addExchangeRate(userId, parsed.data);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/reports");
  revalidatePath("/settings");
  return { ok: true, message: "Exchange rate saved." };
}

export async function changePasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireSession();
  const parsed = passwordChangeSchema.safeParse(formDataObject(formData));
  if (!parsed.success) return zodActionError(parsed.error);
  const session = await changeUserPassword(
    userId,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (!session) {
    return { message: "The current password is incorrect." };
  }
  await createSession(userId, session.sessionVersion, session.sessionTimeoutMinutes);
  return { ok: true, message: "Password changed. Other sessions were signed out." };
}
